import { getShopifyAuthContext } from '../shopify-auth-context.js';

const VERSION='2026-10';
const jp=/[\u3040-\u30ff\u3400-\u9fff]/;
function text(v){return String(v??'').trim()}
function priceOk(v){const n=Number(v);return Number.isFinite(n)&&n>0}
function assess(p){
  const v=p.variants?.nodes?.[0]||{};
  const reasons=[];
  const title=text(p.title),description=text(p.description);
  const media=(p.media?.nodes||[]).filter(x=>text(x?.image?.url));
  const tags=(p.tags||[]).map(text);
  const metafields=p.metafields?.nodes||[];
  const byKey=Object.fromEntries(metafields.map(x=>[x.key,text(x.value)]));
  if(p.status!=='DRAFT')reasons.push('下書きではありません');
  if(!jp.test(title))reasons.push('商品名が日本語未確認');
  if(!jp.test(description))reasons.push('商品説明が日本語未確認');
  if(tags.includes('要日本語確認'))reasons.push('日本語確認タグあり');
  if(!text(v.sku))reasons.push('SKU未設定');
  if(!priceOk(v.price))reasons.push('販売価格未設定');
  if(v.inventoryPolicy==='CONTINUE')reasons.push('欠品時も販売継続する設定（在庫リスク）');
  if(v.inventoryManagement&&v.inventoryManagement!=='NOT_MANAGED'&&Number(v.inventoryQuantity)<=0)reasons.push('Shopify在庫がゼロ以下');
  if(v.inventoryManagement==='NOT_MANAGED')reasons.push('在庫追跡が無効（CJ在庫照合が必要）');
  if(media.length<1)reasons.push('商品画像なし');
  if(!byKey.adps_audience)reasons.push('対象顧客情報なし');
  if(!byKey.adps_summary)reasons.push('AIO商品要約なし');
  if(!byKey.adps_why)reasons.push('選定理由なし');
  if(!byKey.shipping_price_jpy)reasons.push('送料未設定');
  const shipping=Number(byKey.shipping_price_jpy);
  if(byKey.shipping_price_jpy&&(!Number.isFinite(shipping)||shipping<0))reasons.push('送料の形式が不正');
  if(byKey.shipping_price_jpy&&Number.isFinite(shipping)&&shipping>Number(v.price||0))reasons.push('送料が販売価格を上回る（採算確認）');
  if(!/^[A-Z]{2}$/.test(byKey.shipping_country||''))reasons.push('配送国未設定');
  if(!/^[1-9]\d*$/.test(byKey.return_days||''))reasons.push('返品受付日数未設定');
  return {
    id:text(p.id),title,status:text(p.status),handle:text(p.handle),
    sku:text(v.sku),price:Number(v.price||0),imageCount:media.length,
    ready:reasons.length===0,reasons
  };
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
  if(!admin||req.headers?.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  const auth=await getShopifyAuthContext(req);
  if(!auth.ok)return res.status(auth.status).json({ok:false,error:auth.error});
  const {shop,token}=auth;
  const endpoint='https://'+shop+'/admin/api/'+VERSION+'/graphql.json';
  const query=`query PrelaunchProductAudit($first:Int!,$after:String){
    products(first:$first,after:$after,query:"vendor:ODDLY OR vendor:\\"AI BUYER\\""){
      nodes{
        id title description handle status vendor tags
        variants(first:2){nodes{id sku price inventoryPolicy inventoryQuantity inventoryManagement} pageInfo{hasNextPage}}
        media(first:12){nodes{... on MediaImage{image{url}}} pageInfo{hasNextPage}}
        metafields(first:30,namespace:"custom"){nodes{key value} pageInfo{hasNextPage}}
      }
      pageInfo{hasNextPage endCursor}
    }
  }`;
  try{
    let after=null,more=true,pages=0,rows=[];
    while(more&&pages<10){
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables:{first:100,after}}),signal:AbortSignal.timeout(10000)});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify product audit failed');
      const conn=j.data?.products;
      if(!Array.isArray(conn?.nodes)||!conn?.pageInfo)throw Error('Invalid Shopify audit response');
      for(const p of conn.nodes){
        if(p.variants?.pageInfo?.hasNextPage||p.media?.pageInfo?.hasNextPage||p.metafields?.pageInfo?.hasNextPage){
          rows.push({id:text(p.id),title:text(p.title),status:text(p.status),ready:false,reasons:['監査対象データが上限を超えています']});
        }else rows.push(assess(p));
      }
      more=conn.pageInfo.hasNextPage===true;after=conn.pageInfo.endCursor||null;pages++;
      if(more&&!after)throw Error('Shopify audit cursor missing');
    }
    const draftRows=rows.filter(x=>x.status==='DRAFT');
    const notReady=draftRows.filter(x=>!x.ready);
    return res.status(200).json({
      ok:true,readOnly:true,checkedAt:new Date().toISOString(),
      totalManaged:rows.length,draftCount:draftRows.length,readyDrafts:draftRows.length-notReady.length,
      blockedDrafts:notReady.length,allDraftsReady:draftRows.length>0&&notReady.length===0,
      products:rows.slice(0,100),
      partial:more
    });
  }catch(e){
    return res.status(503).json({ok:false,error:e.message||'Unable to audit Shopify drafts'});
  }
}
