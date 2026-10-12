import crypto from 'node:crypto';
import {linkedSandboxOrder,trackingOf,redis} from '../sandbox-order.js';

const str=(v,n=200)=>String(v??'').trim().slice(0,n);
const GQL='/admin/api/2026-10/graphql.json';
async function shopify(shop,token,query,variables){
  const r=await fetch('https://'+shop+GQL,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(12000)});
  const j=await r.json();
  if(!r.ok||j.errors?.length||!j.data)throw Error('Shopify API verification failed');
  return j.data;
}
const QUERY=`query($id:ID!){node(id:$id){... on Order{id test cancelledAt displayFinancialStatus displayFulfillmentStatus fulfillments{trackingInfo{number}} fulfillmentOrders(first:10){pageInfo{hasNextPage} nodes{id status lineItems(first:100){pageInfo{hasNextPage} nodes{id remainingQuantity}}}}}}}`;
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const key=process.env.AI_BUYER_ADMIN_KEY;
  if(!key||req.headers.authorization!=='Bearer '+key)return res.status(401).json({ok:false,error:'Unauthorized'});
  if(process.env.CJ_SANDBOX_TRACKING_SYNC_ENABLED!=='true')return res.status(403).json({ok:false,error:'Sandbox tracking sync is disabled'});
  const shop=str(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN,150).toLowerCase();
  const id=str(req.body?.shopifyOrderId,30);
  const token=process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||!/^\d{1,30}$/.test(id)||!token)return res.status(400).json({ok:false,error:'Shopify configuration or test order ID missing'});
  try{
    const {data:cj}=await linkedSandboxOrder(shop,id);
    const tracking=str(trackingOf(cj));
    if(!tracking||!['SHIPPED','DELIVERED'].includes(str(cj.orderStatus||cj.status,50).toUpperCase()))return res.status(409).json({ok:false,error:'CJ sandbox shipment is not verified'});
    const gid='gid://shopify/Order/'+id;
    const data=await shopify(shop,token,QUERY,{id:gid});
    const order=data.node;
    if(!order||order.id!==gid||order.test!==true||order.cancelledAt||order.displayFinancialStatus!=='PAID')return res.status(409).json({ok:false,error:'Shopify test order is not eligible'});
    if((order.fulfillments||[]).some(f=>(f.trackingInfo||[]).some(t=>str(t.number)===tracking)))return res.status(200).json({ok:true,alreadySynced:true,shopifyOrderId:id});
    if(order.displayFulfillmentStatus!=='UNFULFILLED'||(order.fulfillments||[]).length)return res.status(409).json({ok:false,error:'Existing fulfillment requires manual review'});
    const conn=order.fulfillmentOrders;
    if(!conn||conn.pageInfo?.hasNextPage||!Array.isArray(conn.nodes)||conn.nodes.length!==1)return res.status(409).json({ok:false,error:'Fulfillment order topology requires manual review'});
    const fo=conn.nodes[0];
    if(fo.status!=='OPEN'||fo.lineItems?.pageInfo?.hasNextPage||!fo.lineItems?.nodes?.length||fo.lineItems.nodes.some(n=>!Number.isSafeInteger(n.remainingQuantity)||n.remainingQuantity<=0))return res.status(409).json({ok:false,error:'Fulfillment order is not fully eligible'});
    const fingerprint=crypto.createHash('sha256').update(shop+':'+id).digest('hex');
    const lock='ai-buyer:sandbox-fulfillment-sync:'+fingerprint;
    const claimed=await redis(['SET',lock,'needs_review:'+tracking,'NX']);
    if(claimed!=='OK')return res.status(409).json({ok:false,needsReview:true,error:'Tracking sync already attempted; verify Shopify before retrying'});
    // A network failure after this point is ambiguous. Never auto-retry or clear the lock.
    const mutation=`mutation($fulfillment:FulfillmentInput!){fulfillmentCreate(fulfillment:$fulfillment){fulfillment{id trackingInfo{number}} userErrors{field message}}}`;
    const fulfillment={lineItemsByFulfillmentOrder:[{fulfillmentOrderId:fo.id}],trackingInfo:{number:tracking,company:str(cj.logisticName||cj.shippingMethod,100)||'Other'},notifyCustomer:false};
    const result=await shopify(shop,token,mutation,{fulfillment});
    const payload=result.fulfillmentCreate;
    if(payload?.userErrors?.length||!payload?.fulfillment?.id)return res.status(409).json({ok:false,needsReview:true,error:'Shopify fulfillment was not confirmed; inspect Shopify before retrying'});
    const verified=await shopify(shop,token,QUERY,{id:gid});
    const actual=verified.node;
    const fulfillmentVerified=actual?.id===gid&&actual?.test===true&&(actual.fulfillments||[]).some(f=>f.trackingInfo?.some(t=>str(t.number)===tracking));
    if(!fulfillmentVerified)return res.status(409).json({ok:false,needsReview:true,automaticRetry:false,error:'Shopify tracking could not be independently verified; inspect Shopify before retrying'});
    try{await redis(['SET',lock,'confirmed:'+str(payload.fulfillment.id,200)]);}catch(_e){return res.status(200).json({ok:true,synced:true,needsReview:true,warning:'Tracking verified in Shopify, but local confirmation could not be stored',shopifyOrderId:id,fulfillmentId:payload.fulfillment.id,trackingNumber:tracking});}
    return res.status(200).json({ok:true,synced:true,verified:true,shopifyOrderId:id,fulfillmentId:payload.fulfillment.id,trackingNumber:tracking});
  }catch(_e){
    return res.status(503).json({ok:false,needsReview:true,automaticRetry:false,error:'Tracking sync could not be verified; inspect Shopify and CJ before retrying'});
  }
}
