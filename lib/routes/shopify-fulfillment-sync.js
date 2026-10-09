import crypto from 'node:crypto';
const VERSION='2026-10';

function cookies(req){
  return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{
    const i=v.indexOf('=');
    return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))];
  }));
}
async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},
    body:JSON.stringify({query,variables}),
    signal:AbortSignal.timeout(10000)
  });
  const j=await r.json();
  if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify API request failed');
  return j.data;
}
function str(v,n=200){return String(v??'').trim().slice(0,n)}
async function reserveSync(shop,orderId,trackingNumber){
  const url=process.env.UPSTASH_REDIS_REST_URL,redisToken=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!redisToken)throw Error('Fulfillment idempotency store is not configured');
  const key='ai-buyer:fulfillment-sync:'+crypto.createHash('sha256').update(shop+':'+orderId+':'+trackingNumber).digest('hex');
  const r=await fetch(url.replace(/\/$/,'')+'/',{method:'POST',headers:{Authorization:'Bearer '+redisToken,'Content-Type':'application/json'},body:JSON.stringify(['SET',key,'reserved','NX']),signal:AbortSignal.timeout(5000)});
  const j=await r.json();if(!r.ok||j.error)throw Error('Fulfillment idempotency store unavailable');
  return {key,reserved:j.result==='OK'};
}
async function markSync(key,state){
  const url=process.env.UPSTASH_REDIS_REST_URL,redisToken=process.env.UPSTASH_REDIS_REST_TOKEN;
  const r=await fetch(url.replace(/\/$/,'')+'/',{method:'POST',headers:{Authorization:'Bearer '+redisToken,'Content-Type':'application/json'},body:JSON.stringify(['SET',key,state]),signal:AbortSignal.timeout(5000)});
  const j=await r.json();if(!r.ok||j.error||j.result!=='OK')throw Error('Unable to persist fulfillment sync state');
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=process.env.AI_BUYER_ADMIN_KEY;
  if(!admin||req.headers.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  if(process.env.SHOPIFY_FULFILLMENT_SYNC_ENABLED!=='true')return res.status(503).json({ok:false,error:'Shopify fulfillment sync is disabled'});
  try{
    const c=cookies(req),token=String(c.shopify_access_token||''),shop=String(c.shopify_connected_shop||'').toLowerCase();
    if(!token||!shop)return res.status(401).json({ok:false,authRequired:true,error:'Shopify authentication required'});
    const allowed=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
    if(!allowed||shop!==allowed)return res.status(403).json({ok:false,error:'Shopify shop is not authorized'});
    const orderId=str(req.body?.orderId,80);
    const trackingNumber=str(req.body?.trackingNumber,200);
    const trackingCompany=str(req.body?.trackingCompany,100);
    const trackingUrl=str(req.body?.trackingUrl,500);
    if(!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId))return res.status(400).json({ok:false,error:'Valid Shopify order GID is required'});
    if(!trackingNumber)return res.status(400).json({ok:false,error:'trackingNumber is required'});
    const reservation=await reserveSync(shop,orderId,trackingNumber);
    if(!reservation.reserved)return res.status(200).json({ok:true,skipped:true,reason:'Tracking sync already reserved or completed'});
    const data=await gql(shop,token,`query($id:ID!){ order(id:$id){ id fulfillmentOrders(first:20){nodes{id status requestStatus supportedActions{action}}} } }`,{id:orderId});
    const nodes=data.order?.fulfillmentOrders?.nodes||[];
    const target=nodes.find(x=>x.status==='OPEN'||x.status==='IN_PROGRESS'||x.status==='SCHEDULED');
    if(!target){await markSync(reservation.key,'needs_review:no_fulfillable_order');return res.status(409).json({ok:false,needsReview:true,error:'No fulfillable Shopify fulfillment order found'});}
    const input={
      lineItemsByFulfillmentOrder:[{fulfillmentOrderId:target.id}],
      notifyCustomer:false,
      trackingInfo:{
        number:trackingNumber,
        company:trackingCompany||undefined,
        url:trackingUrl||undefined
      }
    };
    let out;
    try{out=await gql(shop,token,`mutation($fulfillment:FulfillmentInput!){ fulfillmentCreate(fulfillment:$fulfillment){ fulfillment{id status trackingInfo(first:10){number company url}} userErrors{field message}} }`,{fulfillment:input});}
    catch(e){await markSync(reservation.key,'needs_review:unknown_shopify_result');throw e;}
    const result=out.fulfillmentCreate,errs=result?.userErrors||[];
    if(errs.length||!result?.fulfillment){await markSync(reservation.key,'needs_review:shopify_rejected');return res.status(422).json({ok:false,needsReview:true,error:errs.map(x=>x.message).join(' / ')||'Shopify fulfillment creation failed'});}
    await markSync(reservation.key,'synced:'+result.fulfillment.id);
    return res.status(200).json({ok:true,fulfillmentId:result.fulfillment.id,status:result.fulfillment.status,trackingInfo:result.fulfillment.trackingInfo,customerNotified:false});
  }catch(e){
    return res.status(500).json({ok:false,error:e.message||'Unable to create Shopify fulfillment'});
  }
}
