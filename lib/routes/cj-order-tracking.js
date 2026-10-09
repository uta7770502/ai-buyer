const BASE='https://developers.cjdropshipping.com/api2.0/v1';
let cached='',expiresAt=0;

async function token(){
  if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
  if(cached&&Date.now()<expiresAt-60000)return cached;
  if(!process.env.CJ_API_KEY)throw Error('CJ_API_KEY is not configured');
  const r=await fetch(BASE+'/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:process.env.CJ_API_KEY}),signal:AbortSignal.timeout(8000)});
  const j=await r.json();
  if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error(j.message||'CJ authentication failed');
  cached=j.data.accessToken;expiresAt=Date.now()+12*60*60*1000;return cached;
}
function str(v,n=200){return String(v??'').trim().slice(0,n)}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=process.env.AI_BUYER_ADMIN_KEY;
  if(!admin||req.headers.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  const orderId=str(req.query.orderId,200);
  if(!orderId||!/^[A-Za-z0-9_-]{3,200}$/.test(orderId))return res.status(400).json({ok:false,error:'Valid CJ orderId is required'});
  try{
    const access=await token();
    const r=await fetch(BASE+'/shopping/order/getOrderDetail?orderId='+encodeURIComponent(orderId),{headers:{'CJ-Access-Token':access},signal:AbortSignal.timeout(10000)});
    const j=await r.json();
    if(!r.ok||j.result!==true||!j.data)throw Error(j.message||'CJ order lookup failed');
    const d=j.data;
    const trackingNumber=str(d.trackingNumber||d.trackNumber||d.logisticTrackingNumber,200)||null;
    const logisticName=str(d.logisticName||d.shippingMethod,100)||null;
    const orderStatus=str(d.orderStatus||d.status,50)||null;
    return res.status(200).json({
      ok:true,
      cjOrderId:str(d.orderId||d.cjOrderId||orderId,200),
      orderStatus,
      logisticName,
      trackingNumber,
      shipped:orderStatus==='SHIPPED'||orderStatus==='DELIVERED',
      delivered:orderStatus==='DELIVERED'
    });
  }catch(e){
    return res.status(502).json({ok:false,error:e.message||'Unable to read CJ order status'});
  }
}
