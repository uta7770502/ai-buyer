import {getShopifyAuthContext} from '../shopify-auth-context.js';
import {getUsdJpyRate} from '../server-fx.js';

const BASE='https://developers.cjdropshipping.com/api2.0/v1';
const VERSION='2026-10';
const TIMEOUT=10000;
const delay=ms=>new Promise(r=>setTimeout(r,ms));

async function token(){
  if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
  const apiKey=String(process.env.CJ_API_KEY||'');
  if(!apiKey)throw Error('CJ_API_KEY is not configured');
  const r=await fetch(BASE+'/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey}),signal:AbortSignal.timeout(TIMEOUT)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error('CJ auth failed');
  return j.data.accessToken;
}
async function gql(endpoint,access,query,variables={}){
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':access},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(TIMEOUT)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j?.errors?.length||!j?.data)throw Error('Shopify query failed');
  return j.data;
}
function money(v){
  const s=String(v??'').trim();
  if(!/^\d+(?:\.\d+)?$/.test(s))return null;
  const n=Number(s);return Number.isFinite(n)&&n>=0?n:null;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const allowed=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='safety-gate-20261024';
  if(!allowed)return res.status(404).json({ok:false});
  const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
  if(!admin)return res.status(503).json({ok:false,error:'Preview admin key missing'});
  const auth=await getShopifyAuthContext({headers:{authorization:'Bearer '+admin}});
  if(!auth.ok)return res.status(auth.status).json({ok:false,error:auth.error});
  try{
    const endpoint='https://'+auth.shop+'/admin/api/'+VERSION+'/graphql.json';
    const query=`query ProfitAuditProducts($first:Int!){
      products(first:$first,query:"status:draft AND (vendor:ODDLY OR vendor:\\"AI BUYER\\")"){
        pageInfo{hasNextPage}
        nodes{
          id title status vendor
          variants(first:2){pageInfo{hasNextPage} nodes{id sku price}}
          metafields(first:30,namespace:"custom"){pageInfo{hasNextPage} nodes{key value}}
        }
      }
    }`;
    const data=await gql(endpoint,auth.token,query,{first:100});
    const products=data?.products?.nodes;
    if(!Array.isArray(products)||data.products.pageInfo?.hasNextPage||products.length===0)return res.status(409).json({ok:false,error:'Shopify profit audit incomplete'});
    const fx=await getUsdJpyRate();
    if(fx.verified!==true)return res.status(503).json({ok:false,error:'USD/JPY rate unavailable'});
    const cj=await token(),rows=[];
    for(const p of products){
      const variants=p?.variants?.nodes||[];
      const meta=Object.fromEntries((p?.metafields?.nodes||[]).map(x=>[x.key,String(x.value??'').trim()]));
      if(p.status!=='DRAFT'||!['ODDLY','AI BUYER'].includes(p.vendor)||p.variants?.pageInfo?.hasNextPage||p.metafields?.pageInfo?.hasNextPage||variants.length!==1){
        rows.push({title:p?.title||'',sku:String(variants[0]?.sku||''),ok:false,reason:'shopify-product-unverified'});continue;
      }
      const v=variants[0],vid=String(v.sku||'').trim(),sale=money(v.price),shipping=money(meta.shipping_price_jpy),plannedAds=money(meta.ad_cost_per_order_jpy),returnReserve=money(meta.return_reserve_per_order_jpy);
      if(!/^\d{10,25}$/.test(vid)||sale===null||sale<=0||shipping===null){
        rows.push({title:p.title,sku:vid,ok:false,reason:'price-or-shipping-unverified'});continue;
      }
      const u=new URL(BASE+'/product/variant/queryByVid');u.searchParams.set('vid',vid);
      const rr=await fetch(u,{headers:{'CJ-Access-Token':cj},signal:AbortSignal.timeout(TIMEOUT)});
      const jj=await rr.json().catch(()=>({})),d=jj?.data;
      const raw=d?.variantSellPrice??d?.sellPrice??d?.price;
      const usd=money(raw);
      if(!rr.ok||jj.result!==true||!d||String(d.vid??d.id??d.variantId??'')!==vid||usd===null){
        rows.push({title:p.title,sku:vid,ok:false,reason:'cj-cost-unverified'});await delay(1200);continue;
      }
      const costJpy=Math.ceil(usd*fx.usdJpyRate);
      const grossProfit=Math.round(sale-costJpy-shipping);
      const margin=Math.round(grossProfit/sale*1000)/10;
      const paymentFeeJpy=Math.round(sale*0.045);
      const contributionBeforeAdsJpy=Math.round(sale-costJpy-shipping-paymentFeeJpy);
      const contributionMarginPercent=Math.round(contributionBeforeAdsJpy/sale*1000)/10;
      const minimumContributionMarginPercent=35;
      const assumptionsReady=plannedAds!==null&&returnReserve!==null;
      const finalProfitJpy=assumptionsReady?Math.round(contributionBeforeAdsJpy-plannedAds-returnReserve):null;
      const finalMarginPercent=assumptionsReady?Math.round(finalProfitJpy/sale*1000)/10:null;
      rows.push({title:p.title,sku:vid,ok:true,salePriceJpy:sale,productCostUsd:usd,productCostJpy:costJpy,shippingJpy:shipping,grossProfitJpy:grossProfit,grossMarginPercent:margin,paymentFeeJpy,contributionBeforeAdsJpy,contributionMarginPercent,plannedAdCostPerOrderJpy:plannedAds,returnReservePerOrderJpy:returnReserve,assumptionsReady,finalProfitJpy,finalMarginPercent,profitableBeforeFees:grossProfit>0,minimumContributionMarginPercent,launchEconomicsEligible:assumptionsReady&&contributionBeforeAdsJpy>0&&contributionMarginPercent>=minimumContributionMarginPercent&&finalProfitJpy>0});
      await delay(1200);
    }
    return res.status(200).json({ok:true,readOnly:true,checkedAt:new Date().toISOString(),fx:{usdJpyRate:fx.usdJpyRate,verified:true},paymentFeeRatePercent:4.5,minimumContributionMarginPercent:35,requiredMetafields:['custom.ad_cost_per_order_jpy','custom.return_reserve_per_order_jpy'],total:rows.length,verified:rows.filter(x=>x.ok).length,failed:rows.filter(x=>!x.ok).length,positiveBeforeFees:rows.filter(x=>x.ok&&x.profitableBeforeFees).length,launchEconomicsEligible:rows.filter(x=>x.ok&&x.launchEconomicsEligible).length,rows});
  }catch{return res.status(503).json({ok:false,error:'Profit audit failed'})}
}
