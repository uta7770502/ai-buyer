import crypto from 'node:crypto';
import {getShopifyAuthContext} from '../shopify-auth-context.js';
import {getUsdJpyRate} from '../server-fx.js';
import {validateCJStockResponse} from '../cj-stock-validation.js';

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
  // Require the caller's admin bearer token. Never authenticate using a server-generated header.
  const provided=String(req.headers?.authorization||'');
  const expected='Bearer '+admin;
  const actualBytes=Buffer.from(provided),expectedBytes=Buffer.from(expected);
  if(actualBytes.length!==expectedBytes.length||!crypto.timingSafeEqual(actualBytes,expectedBytes))return res.status(401).json({ok:false,error:'Admin authorization required'});
  const auth=await getShopifyAuthContext(req);
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
    // Duplicate CJ variant IDs cannot be independently reconciled to Shopify drafts.
    // Fail closed before requesting CJ pricing, stock, or freight data.
    const skuCounts=new Map();
    for(const p of products){
      const sku=String(p?.variants?.nodes?.[0]?.sku||'').trim();
      if(sku)skuCounts.set(sku,(skuCounts.get(sku)||0)+1);
    }
    const cj=await token(),rows=[];
    for(const p of products){
      const variants=p?.variants?.nodes||[];
      const meta=Object.fromEntries((p?.metafields?.nodes||[]).map(x=>[x.key,String(x.value??'').trim()]));
      if(p.status!=='DRAFT'||!['ODDLY','AI BUYER'].includes(p.vendor)||p.variants?.pageInfo?.hasNextPage||p.metafields?.pageInfo?.hasNextPage||variants.length!==1){
        rows.push({title:p?.title||'',sku:String(variants[0]?.sku||''),ok:false,reason:'shopify-product-unverified'});continue;
      }
      const v=variants[0],vid=String(v.sku||'').trim(),sale=money(v.price),shipping=money(meta.shipping_price_jpy),plannedAds=money(meta.ad_cost_per_order_jpy),returnReserve=money(meta.return_reserve_per_order_jpy);
      if(vid&&skuCounts.get(vid)>1){
        rows.push({title:p.title,sku:vid,ok:false,reason:'duplicate-cj-variant-id'});continue;
      }
      if(!/^\d{10,25}$/.test(vid)||sale===null||sale<=0){
        rows.push({title:p.title,sku:vid,ok:false,reason:'price-or-variant-unverified'});continue;
      }
      const u=new URL(BASE+'/product/variant/queryByVid');u.searchParams.set('vid',vid);
      const rr=await fetch(u,{headers:{'CJ-Access-Token':cj},signal:AbortSignal.timeout(TIMEOUT)});
      const jj=await rr.json().catch(()=>({})),d=jj?.data;
      const raw=d?.variantSellPrice??d?.sellPrice??d?.price;
      const usd=money(raw);
      const declaredSupplierCurrency=String(d?.currency||d?.currencyCode||d?.priceCurrency||'').trim().toUpperCase();
      if(!rr.ok||jj.result!==true||!d||String(d.vid??d.id??d.variantId??'')!==vid||usd===null||usd<=0||declaredSupplierCurrency!=='USD'){
        rows.push({title:p.title,sku:vid,ok:false,reason:'cj-cost-unverified'});await delay(1200);continue;
      }
      // Independent read-only stock check; only CJ-managed inventory counts.
      let cjStockVerified=false,cjStockAvailable=false,cjStockQuantity=null,cjStockReason='cj-stock-unavailable';
      try{
        await delay(1200);
        const su=new URL(BASE+'/product/stock/queryByVid');su.searchParams.set('vid',vid);
        const sr=await fetch(su,{headers:{'CJ-Access-Token':cj},signal:AbortSignal.timeout(TIMEOUT)});
        const sj=await sr.json().catch(()=>({}));
        const stock=sr.ok?validateCJStockResponse(sj):{ok:false,reason:sr.status===429?'cj-rate-limited':'cj-stock-http-error'};
        if(stock.ok){cjStockVerified=true;cjStockQuantity=stock.total;cjStockAvailable=stock.total>=5;cjStockReason=cjStockAvailable?'cj-stock-at-least-five':'cj-stock-below-five';}
        else cjStockReason=stock.reason;
      }catch{cjStockReason='cj-stock-fetch-failed'}
      // Fetch actual CJ freight quote for the exact variant and JP destination.
      // This is informational only until payment fees and all costs are verified.
      let cjFreightJpy=null,cjFreightVerified=false,cjFreightReason='cj-freight-unavailable';
      try{
        await delay(1200);
        const fr=await fetch(BASE+'/logistic/freightCalculate',{
          method:'POST',headers:{'CJ-Access-Token':cj,'Content-Type':'application/json'},
          body:JSON.stringify({startCountryCode:'CN',endCountryCode:'JP',products:[{quantity:1,vid}]}),
          signal:AbortSignal.timeout(TIMEOUT)
        });
        const fj=await fr.json().catch(()=>({}));
        const options=Array.isArray(fj?.data)?fj.data:[];
        const prices=options.filter(x=>{const currency=String(x?.currency||x?.currencyCode||x?.priceCurrency||'').trim().toUpperCase();return currency==='USD';}).map(x=>money(x?.totalPostageFee??x?.logisticPrice)).filter(x=>x!==null&&x>0);
        if(fr.ok&&fj.result===true&&prices.length>0&&Number.isFinite(fx.usdJpyRate)&&fx.usdJpyRate>0){
          cjFreightJpy=Math.ceil(Math.min(...prices)*fx.usdJpyRate);
          cjFreightVerified=true;cjFreightReason='cj-jp-quote';
        }
      }catch{cjFreightReason='cj-freight-fetch-failed'}
      const costJpy=Math.ceil(usd*fx.usdJpyRate);
      // Use only the fresh CJ JP quote for estimates; never silently fall back to stored shipping.
      const auditShippingJpy=cjFreightVerified?cjFreightJpy:null;
      const grossProfit=auditShippingJpy===null?null:Math.round(sale-costJpy-auditShippingJpy);
      const margin=grossProfit===null?null:Math.round(grossProfit/sale*1000)/10;
      const configuredFeeRate=money(meta.payment_fee_rate_percent);
      const configuredFixedFee=money(meta.payment_fixed_fee_jpy);
      const configuredPlatformFee=money(meta.platform_fee_per_order_jpy);
      const paymentFeeAssumptionsReady=configuredFeeRate!==null&&configuredFeeRate<=100&&configuredFixedFee!==null&&configuredPlatformFee!==null;
      const paymentFeeJpy=paymentFeeAssumptionsReady?Math.ceil(sale*configuredFeeRate/100+configuredFixedFee+configuredPlatformFee):null;
      const contributionBeforeAdsJpy=auditShippingJpy===null||paymentFeeJpy===null?null:Math.round(sale-costJpy-auditShippingJpy-paymentFeeJpy);
      const contributionMarginPercent=contributionBeforeAdsJpy===null?null:Math.round(contributionBeforeAdsJpy/sale*1000)/10;
      // Informational budget ceilings only; never substitute for verified ad/return assumptions.
      const maxCombinedAdsReturnsForPositiveProfitJpy=contributionBeforeAdsJpy===null?null:Math.max(0,contributionBeforeAdsJpy-1);
      const maxCombinedAdsReturnsForFivePercentNetJpy=contributionBeforeAdsJpy===null?null:Math.max(0,contributionBeforeAdsJpy-Math.ceil(sale*0.05));
      const minimumContributionMarginPercent=30;
      const assumptionsReady=auditShippingJpy!==null&&paymentFeeAssumptionsReady&&plannedAds!==null&&returnReserve!==null;
      const finalProfitJpy=assumptionsReady?Math.round(contributionBeforeAdsJpy-plannedAds-returnReserve):null;
      const finalMarginPercent=assumptionsReady?Math.round(finalProfitJpy/sale*1000)/10:null;
      // Read-only recommendation guidance; this never grants launch approval.
      const estimatedMarginTier=!assumptionsReady||finalProfitJpy<=0?null:finalProfitJpy/sale>=0.30?30:finalProfitJpy/sale>=0.25?25:finalProfitJpy/sale>=0.20?20:null;
      const marginReviewRequired=estimatedMarginTier!==null&&estimatedMarginTier<30;
      // The CJ freight quote is checked, but payment fees and reserves remain assumptions.
      // Never promote this audit's estimates to recommendation eligibility.
      const contributionMarginVerified=false,finalProfitVerified=false;
      const profitVerificationReason=!cjFreightVerified?'cj_freight_not_verified':!paymentFeeAssumptionsReady?'payment_fee_assumptions_missing':'actual_payment_fees_not_verified';
      const profitEvidence={supplierQuote:{source:'cj-variant',currency:declaredSupplierCurrency,verified:true,settledCostVerified:false},freight:{source:'cj-freight-quote',currency:'USD',verified:cjFreightVerified},paymentFees:{source:'shopify-metafield-assumptions',verified:false},advertising:{source:'shopify-metafield-assumptions',verified:false},returns:{source:'shopify-metafield-assumptions',verified:false},recommendationEligible:false};
      // Informational triage only. Never grants publication or recommendation eligibility.
      const estimatedAuditStatus=!cjStockVerified||!cjStockAvailable||!cjFreightVerified||!assumptionsReady
        ?'hold'
        :estimatedMarginTier===30?'provisional-pass'
        :estimatedMarginTier===25||estimatedMarginTier===20?'exception-review'
        :'exclude';
      const estimatedAuditReason=!cjStockVerified?'stock-unverified'
        :!cjStockAvailable?'stock-below-five'
        :!cjFreightVerified?'freight-unverified'
        :!assumptionsReady?'cost-assumptions-incomplete'
        :estimatedMarginTier===30?'estimated-margin-at-least-30'
        :estimatedMarginTier===25||estimatedMarginTier===20?'requires-explicit-margin-exception'
        :'estimated-margin-below-20-or-nonpositive';
      rows.push({title:p.title,sku:vid,ok:true,profitEvidence,supplierQuoteVerified:true,settledSupplierCostVerified:false,shopifyPaymentFeesVerified:false,salePriceJpy:sale,productCostUsd:usd,productCostJpy:costJpy,shippingJpy:shipping,estimatedAuditStatus,estimatedAuditReason,cjStockVerified,cjStockAvailable,cjStockQuantity,cjStockReason,cjFreightJpy,cjFreightVerified,cjFreightReason,auditShippingJpy,shippingDifferenceJpy:cjFreightVerified&&shipping!==null?cjFreightJpy-shipping:null,grossProfitJpy:grossProfit,grossMarginPercent:margin,paymentFeeJpy,paymentFeeAssumptionsReady,paymentFeeRatePercent:configuredFeeRate,paymentFixedFeeJpy:configuredFixedFee,platformFeeJpy:configuredPlatformFee,contributionBeforeAdsJpy,contributionMarginPercent,maxCombinedAdsReturnsForPositiveProfitJpy,maxCombinedAdsReturnsForFivePercentNetJpy,plannedAdCostPerOrderJpy:plannedAds,returnReservePerOrderJpy:returnReserve,assumptionsReady,finalProfitJpy,finalMarginPercent,estimatedMarginTier,marginReviewRequired,contributionMarginVerified,finalProfitVerified,profitVerificationReason,profitableBeforeFees:grossProfit!==null&&grossProfit>0,minimumContributionMarginPercent,launchEconomicsEligible:false,estimatedEconomicsEligible:estimatedAuditStatus==='provisional-pass',estimatedExceptionReviewEligible:estimatedAuditStatus==='exception-review'});
      await delay(1200);
    }
    return res.status(200).json({ok:true,readOnly:true,checkedAt:new Date().toISOString(),fx:{usdJpyRate:fx.usdJpyRate,verified:true},paymentFeeSource:'shopify-metafield-assumptions-not-verified',supplierCostSource:'cj-selected-variant-quote-not-settled',finalProfitEvidenceReady:false,minimumContributionMarginPercent:30,requiredMetafields:['custom.ad_cost_per_order_jpy','custom.return_reserve_per_order_jpy','custom.payment_fee_rate_percent','custom.payment_fixed_fee_jpy','custom.platform_fee_per_order_jpy'],total:rows.length,verified:0,costChecked:rows.filter(x=>x.ok).length,supplierQuoteChecked:rows.filter(x=>x.ok).length,settledSupplierCostVerified:0,shopifyPaymentFeesVerified:0,finalProfitEvidenceReady:false,freightChecked:rows.filter(x=>x.ok&&x.cjFreightVerified).length,stockChecked:rows.filter(x=>x.ok&&x.cjStockVerified).length,stockAvailable:rows.filter(x=>x.ok&&x.cjStockAvailable).length,provisionalPass:rows.filter(x=>x.ok&&x.estimatedAuditStatus==='provisional-pass').length,exceptionReview:rows.filter(x=>x.ok&&x.estimatedAuditStatus==='exception-review').length,held:rows.filter(x=>x.ok&&x.estimatedAuditStatus==='hold').length,excluded:rows.filter(x=>x.ok&&x.estimatedAuditStatus==='exclude').length,profitVerified:0,failed:rows.filter(x=>!x.ok).length,positiveBeforeFees:rows.filter(x=>x.ok&&x.profitableBeforeFees).length,launchEconomicsEligible:0,estimatedEconomicsEligible:rows.filter(x=>x.ok&&x.estimatedEconomicsEligible).length,estimatedExceptionReviewEligible:rows.filter(x=>x.ok&&x.estimatedExceptionReviewEligible).length,rows});
  }catch{return res.status(503).json({ok:false,error:'Profit audit failed'})}
}
