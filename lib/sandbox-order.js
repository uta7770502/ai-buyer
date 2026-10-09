import crypto from 'node:crypto';
const BASE='https://developers.cjdropshipping.com/api2.0/v1';
let cached='',expiresAt=0;
export async function redis(command){
  const url=process.env.UPSTASH_REDIS_REST_URL,token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token)throw Error('Order store is not configured');
  const r=await fetch(url.replace(/\/$/,'')+'/',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(5000)});
  const j=await r.json();if(!r.ok||j.error||!Object.hasOwn(j,'result'))throw Error('Order store unavailable');return j.result;
}
export function orderKey(shop,id){return 'ai-buyer:cj-sandbox:'+crypto.createHash('sha256').update(shop+':'+id).digest('hex')}
async function token(){
  if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
  if(cached&&Date.now()<expiresAt-60000)return cached;
  if(!process.env.CJ_API_KEY)throw Error('CJ credentials missing');
  const r=await fetch(BASE+'/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:process.env.CJ_API_KEY}),signal:AbortSignal.timeout(8000)});
  const j=await r.json();if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error('CJ authentication failed');
  cached=j.data.accessToken;expiresAt=Date.now()+12*3600000;return cached;
}
export async function readCjOrder(orderId){
  const r=await fetch(BASE+'/shopping/order/getOrderDetail?orderId='+encodeURIComponent(orderId),{headers:{'CJ-Access-Token':await token()},signal:AbortSignal.timeout(10000)});
  const j=await r.json();if(!r.ok||j.result!==true||!j.data||Array.isArray(j.data))throw Error('CJ order lookup failed');return j.data;
}
export function isSandbox(d){return d.isSandbox===1||d.isSandbox==='1'||d.isSandbox===true}
export function trackingOf(d){return String(d.trackNumber||d.trackingNumber||d.logisticTrackingNumber||'').trim()}
export async function linkedSandboxOrder(shop,numericId){
  const state=await redis(['GET',orderKey(shop,numericId)]);
  if(typeof state!=='string'||!/^created:[A-Za-z0-9_-]{3,200}$/.test(state))throw Error('CJ order has not been confirmed; reconcile first');
  const id=state.slice(8),data=await readCjOrder(id);
  if(!isSandbox(data))throw Error('CJ sandbox status is not confirmed');
  return {id,data};
}
// This allowlist deliberately excludes every real payment and order-creation endpoint.
export async function simulateCj(phase,orderId,trackNumber){
  if(!['payment','tracking'].includes(phase))throw Error('Unsupported sandbox action');
  const suffix=phase==='payment'?'simulatePay':'updateTrackNumber';
  const body=phase==='payment'?{orderId}:{orderId,trackNumber};
  const r=await fetch(BASE+'/shopping/sandbox/'+suffix,{method:'POST',headers:{'CJ-Access-Token':await token(),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const j=await r.json();if(!r.ok||j.result!==true||j.data!==true)throw Error('CJ simulation outcome requires review');
}
