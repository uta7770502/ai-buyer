import crypto from 'node:crypto';

// Admin-only read of the persistent CJ sandbox order reservation.
// This endpoint cannot place orders, retry payments, or change order state.
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'Method not allowed'});}
  const key=process.env.AI_BUYER_ADMIN_KEY;
  if(!key||req.headers.authorization!=='Bearer '+key)return res.status(401).json({ok:false,error:'Unauthorized'});
  const allowedShop=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
  const requestedShop=String(req.query.shop||'').trim().toLowerCase();
  const shop=requestedShop||allowedShop;
  const orderId=String(req.query.orderId||'');
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||!/^[0-9]{1,30}$/.test(orderId)){
    return res.status(400).json({ok:false,error:'Configured shop and numeric orderId are required'});
  }
  if(!allowedShop||shop!==allowedShop)return res.status(403).json({ok:false,error:'Shopify shop is not authorized'});
  const url=process.env.UPSTASH_REDIS_REST_URL;
  const token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token)return res.status(503).json({ok:false,error:'Order database is not configured'});
  const id='ai-buyer:cj-sandbox:'+crypto.createHash('sha256').update(shop+':'+orderId).digest('hex');
  try{
    const response=await fetch(url.replace(/\/$/,'')+'/',{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(['GET',id]),signal:AbortSignal.timeout(5000)
    });
    if(!response.ok)throw Error('Order database unavailable');
    const data=await response.json();
    if(data.error)throw Error('Order database rejected query');
    const state=data.result===null?'not_found':String(data.result);
    const status=state==='reserved'||state.startsWith('needs_review:')?'pending_reconciliation':state.startsWith('created:')?'sandbox_created':state==='not_found'?'not_found':'unknown';
    // No customer name, address, API token or Shopify line items in the response.
    const cjOrderId=status==='sandbox_created'?state.slice('created:'.length):null;
    return res.status(200).json({ok:true,shop,orderId,status,needsReview:status==='pending_reconciliation',sandbox:true,cjOrderId,automaticRetry:false});
  }catch{
    return res.status(503).json({ok:false,error:'Unable to read order status'});
  }
}
