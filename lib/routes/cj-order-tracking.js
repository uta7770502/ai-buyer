import crypto from 'node:crypto';
import {linkedSandboxOrder,trackingOf,redis,orderKey} from '../sandbox-order.js';

function str(v,n=200){return String(v??'').trim().slice(0,n)}
function trackingKey(shop,id){
  const fp=crypto.createHash('sha256').update(shop+':'+id).digest('hex');
  return 'ai-buyer:sandbox-tracking:'+fp;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=process.env.AI_BUYER_ADMIN_KEY;
  if(!admin||req.headers.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  const shop=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
  const shopifyOrderId=str(req.query.shopifyOrderId,30);
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||!/^\d{1,30}$/.test(shopifyOrderId)){
    return res.status(400).json({ok:false,error:'Valid Shopify test order ID is required'});
  }
  let localTracking='';
  let createdState='';
  try{
    localTracking=str(await redis(['GET',trackingKey(shop,shopifyOrderId)]),200);
    createdState=str(await redis(['GET',orderKey(shop,shopifyOrderId)]),220);
    const {id:cjOrderId,data:d}=await linkedSandboxOrder(shop,shopifyOrderId);
    const orderStatus=str(d.orderStatus||d.status,50)||null;
    const logisticName=str(d.logisticName||d.shippingMethod,100)||'AI BUYER Sandbox';
    const cjTracking=str(trackingOf(d),200);
    const trackingNumber=cjTracking||localTracking||null;
    return res.status(200).json({
      ok:true,
      cjOrderId,
      shopifyOrderId,
      orderStatus,
      sandbox:true,
      logisticName,
      trackingNumber,
      localSimulation:Boolean(!cjTracking&&localTracking),
      // A simulated tracking number is not evidence of a real CJ shipment.
      shipped:Boolean(cjTracking)&&(['SHIPPED','DELIVERED'].includes(String(orderStatus||'').toUpperCase())),
      delivered:String(orderStatus||'').toUpperCase()==='DELIVERED'
    });
  }catch(e){
    const msg=String(e?.message||'');
    const confirmed=/^created:[A-Za-z0-9_-]{3,200}$/.test(createdState);
    if(localTracking&&confirmed){
      return res.status(200).json({
        ok:true,
        cjOrderId:createdState.slice(8),
        shopifyOrderId,
        orderStatus:'SANDBOX_LOCAL',
        sandbox:true,
        logisticName:'AI BUYER Sandbox',
        trackingNumber:localTracking,
        localSimulation:true,
        shipped:false,
        delivered:false,
        cjReadUnavailable:true
      });
    }
    if(/has not been confirmed|sandbox status is not confirmed/i.test(msg)){
      return res.status(409).json({ok:false,needsReview:true,automaticRetry:false,error:'Unable to verify the linked CJ sandbox order; reconcile before retrying'});
    }
    return res.status(503).json({ok:false,needsReview:false,automaticRetry:false,error:'CJ tracking status is temporarily unavailable; try the read-only check again later'});
  }
}
