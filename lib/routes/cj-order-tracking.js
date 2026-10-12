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
    // Optional, read-only Shopify cross-check. Never mark synchronized if unavailable.
    let shopifySyncVerified=false,alreadyInShopify=false,shopifyLookupError='';
    let shopifyOrderCancelled=false,shopifyFinancialStatus='',shopifyFulfillmentStatus='';
    const shopifyToken=process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    if(shopifyToken&&cjTracking){
      try{
        const gid='gid://shopify/Order/'+shopifyOrderId;
        const sr=await fetch('https://'+shop+'/admin/api/2026-10/graphql.json',{
          method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':shopifyToken},
          body:JSON.stringify({query:'query($id:ID!){node(id:$id){... on Order{id test cancelledAt displayFinancialStatus displayFulfillmentStatus fulfillments{trackingInfo{number}}}}}',variables:{id:gid}}),
          signal:AbortSignal.timeout(10000)
        });
        const sj=await sr.json();
        const so=sj?.data?.node;
        if(!sr.ok||sj.errors?.length||so?.id!==gid||so?.test!==true)throw Error('Shopify test order verification failed');
        shopifySyncVerified=true;
        shopifyOrderCancelled=Boolean(so.cancelledAt);
        shopifyFinancialStatus=str(so.displayFinancialStatus,60).toUpperCase();
        shopifyFulfillmentStatus=str(so.displayFulfillmentStatus,60).toUpperCase();
        alreadyInShopify=(so.fulfillments||[]).some(f=>(f.trackingInfo||[]).some(t=>String(t.number||'').trim()===cjTracking));
      }catch(_e){shopifyLookupError='Shopify tracking lookup unavailable';}
    }
    const shipmentConfirmed=Boolean(cjTracking)&&['SHIPPED','DELIVERED'].includes(String(orderStatus||'').toUpperCase());
    const syncState=!cjTracking?'awaiting_cj_tracking':!shipmentConfirmed?'awaiting_cj_shipment':!shopifySyncVerified?'shopify_verification_unavailable':alreadyInShopify?'already_synced':shopifyOrderCancelled?'shopify_order_cancelled':shopifyFinancialStatus!=='PAID'?'shopify_payment_not_confirmed':shopifyFulfillmentStatus!=='UNFULFILLED'?'shopify_fulfillment_not_eligible':'requires_shopify_sync';
    const eligibleForSync=shipmentConfirmed&&shopifySyncVerified&&!alreadyInShopify&&!shopifyOrderCancelled&&shopifyFinancialStatus==='PAID'&&shopifyFulfillmentStatus==='UNFULFILLED';
    return res.status(200).json({
      ok:true,
      cjOrderId,
      shopifyOrderId,
      orderStatus,
      sandbox:true,
      logisticName,
      trackingNumber,
      localSimulation:Boolean(!cjTracking&&localTracking),
      trackingSource:cjTracking?'cj':localTracking?'sandbox_local':'none',
      requiresShopifySyncReview:shipmentConfirmed&&(!shopifySyncVerified||(!alreadyInShopify&&!shopifyOrderCancelled&&shopifyFinancialStatus==='PAID'&&shopifyFulfillmentStatus==='UNFULFILLED')),
      syncState,
      eligibleForSync,
      // Preliminary only: the write endpoint independently checks fulfillment-order topology and locks.
      eligibilityIsPreliminary:true,
      shopifyOrderCancelled:shopifySyncVerified?shopifyOrderCancelled:null,
      shopifyFinancialStatus:shopifySyncVerified?shopifyFinancialStatus:null,
      shopifyFulfillmentStatus:shopifySyncVerified?shopifyFulfillmentStatus:null,
      shopifySyncVerified,
      alreadyInShopify:shopifySyncVerified?alreadyInShopify:null,
      shopifyLookupError,
      shopifySyncAction:eligibleForSync?'manual_review_required':'none',
      // A simulated tracking number is not evidence of a real CJ shipment.
      shipped:shipmentConfirmed,
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
        trackingSource:'sandbox_local',
        requiresShopifySyncReview:false,
        syncState:'cj_read_unavailable',
        shopifySyncVerified:false,
        shopifySyncAction:'none',
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
