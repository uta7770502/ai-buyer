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
function syncKey(shop,orderId,trackingNumber){
  return 'ai-buyer:fulfillment-sync:'+crypto.createHash('sha256').update(shop+':'+orderId+':'+trackingNumber).digest('hex');
}
async function redis(command){
  const url=process.env.UPSTASH_REDIS_REST_URL,token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token)throw Error('Fulfillment idempotency store is not configured');
  const r=await fetch(url.replace(/\/$/,'')+'/',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(5000)});
  const j=await r.json();
  if(!r.ok||j.error)throw Error('Fulfillment idempotency store unavailable');
  return j.result;
}
async function markSync(key,state){
  if(await redis(['SET',key,state])!=='OK')throw Error('Unable to persist fulfillment sync state');
}
function existingSync(res,state,dryRun){
  if(typeof state==='string'&&/^synced:gid:\/\/shopify\/Fulfillment\/\d+$/.test(state)){
    return res.status(200).json({ok:true,skipped:true,duplicateConfirmed:true,dryRun,fulfillmentId:state.slice(7),customerNotified:false});
  }
  return res.status(409).json({ok:false,needsReview:true,automaticRetry:false,error:'Tracking sync is reserved or unresolved; reconcile manually before proceeding'});
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=process.env.AI_BUYER_ADMIN_KEY;
  if(!admin||req.headers.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  const dryRun=req.body?.dryRun===true;
  const checkOnly=req.body?.checkOnly===true;
  let reservedKey='';
  if(!dryRun&&!checkOnly&&process.env.SHOPIFY_FULFILLMENT_SYNC_ENABLED!=='true')return res.status(503).json({ok:false,error:'Shopify fulfillment sync is disabled'});
  try{
    const c=cookies(req),token=String(c.shopify_access_token||''),shop=String(c.shopify_connected_shop||'').toLowerCase();
    if(!token||!shop)return res.status(401).json({ok:false,authRequired:true,error:'Shopify authentication required'});
    const allowed=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
    if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(allowed)||shop!==allowed)return res.status(403).json({ok:false,error:'Shopify shop is not authorized'});
    const orderId=str(req.body?.orderId,80);
    const trackingNumber=str(req.body?.trackingNumber,200);
    const trackingCompany=str(req.body?.trackingCompany,100);
    const trackingUrl=str(req.body?.trackingUrl,500);
    if(!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId))return res.status(400).json({ok:false,error:'Valid Shopify order GID is required'});
    if(!trackingNumber)return res.status(400).json({ok:false,error:'trackingNumber is required'});
    const key=syncKey(shop,orderId,trackingNumber);
    const prior=await redis(['GET',key]);
    // Check persisted completion before Shopify eligibility: a completed order is no longer OPEN.
    if(prior!==null)return existingSync(res,prior,dryRun);
    // Duplicate verification must never turn into a new fulfillment mutation.
    if(checkOnly)return res.status(409).json({ok:false,error:'No completed tracking sync found',duplicateConfirmed:false});
    const data=await gql(shop,token,`query($id:ID!){ order(id:$id){ id test cancelledAt displayFinancialStatus fulfillmentOrders(first:20){pageInfo{hasNextPage} nodes{id status requestStatus supportedActions{action}}} } }`,{id:orderId});
    if(!data.order||data.order.test!==true||data.order.cancelledAt||data.order.displayFinancialStatus!=='PAID'){
      return res.status(422).json({ok:false,error:'Only paid, uncancelled Shopify test orders may be synchronized'});
    }
    if(data.order.fulfillmentOrders?.pageInfo?.hasNextPage)return res.status(409).json({ok:false,needsReview:true,error:'Order has additional fulfillment orders; manual review required'});
    const nodes=data.order.fulfillmentOrders?.nodes||[];
    const targets=nodes.filter(x=>
      (x.status==='OPEN'||x.status==='IN_PROGRESS'||x.status==='SCHEDULED') &&
      Array.isArray(x.supportedActions) &&
      x.supportedActions.some(a=>a?.action==='CREATE_FULFILLMENT')
    );
    const target=targets.length===1?targets[0]:null;
    if(!target)return res.status(409).json({ok:false,needsReview:true,dryRun,error:'Exactly one eligible Shopify fulfillment order is required; review split or closed orders'});
    if(dryRun)return res.status(200).json({ok:true,dryRun:true,eligible:true,fulfillmentOrderId:target.id,status:target.status,customerNotified:false});
    const reservation=await redis(['SET',key,'reserved','NX']);
    if(reservation===null)return existingSync(res,await redis(['GET',key]),dryRun);
    if(reservation!=='OK')throw Error('Unexpected idempotency reservation response');
    reservedKey=key;
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
    catch(e){await markSync(key,'needs_review:unknown_shopify_result');throw e;}
    const result=out.fulfillmentCreate,errs=result?.userErrors||[];
    if(errs.length||!result?.fulfillment){await markSync(key,'needs_review:shopify_rejected');return res.status(422).json({ok:false,needsReview:true,error:errs.map(x=>x.message).join(' / ')||'Shopify fulfillment creation failed'});}
    await markSync(key,'synced:'+result.fulfillment.id);
    return res.status(200).json({ok:true,fulfillmentId:result.fulfillment.id,status:result.fulfillment.status,trackingInfo:result.fulfillment.trackingInfo,customerNotified:false});
  }catch(e){
    return res.status(reservedKey?202:503).json({ok:false,needsReview:Boolean(reservedKey),automaticRetry:false,error:reservedKey?'Shopify result or persistence is uncertain; reconcile manually without retrying':'Unable to verify Shopify fulfillment or idempotency store'});
  }
}
