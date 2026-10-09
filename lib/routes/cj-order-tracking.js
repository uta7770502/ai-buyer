import {linkedSandboxOrder,trackingOf} from '../sandbox-order.js';

function str(v,n=200){return String(v??'').trim().slice(0,n)}
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
  try{
    const {id:cjOrderId,data:d}=await linkedSandboxOrder(shop,shopifyOrderId);
    const orderStatus=str(d.orderStatus||d.status,50)||null;
    const logisticName=str(d.logisticName||d.shippingMethod,100)||null;
    const trackingNumber=str(trackingOf(d),200)||null;
    return res.status(200).json({
      ok:true,
      cjOrderId,
      shopifyOrderId,
      orderStatus,
      sandbox:true,
      logisticName,
      trackingNumber,
      shipped:orderStatus==='SHIPPED'||orderStatus==='DELIVERED',
      delivered:orderStatus==='DELIVERED'
    });
  }catch{
    return res.status(409).json({ok:false,needsReview:true,automaticRetry:false,error:'Unable to verify the linked CJ sandbox order; reconcile before retrying'});
  }
}
