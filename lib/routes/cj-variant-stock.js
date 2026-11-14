import {validateCJStockResponse} from '../cj-stock-validation.js';

const BASE='https://developers.cjdropshipping.com/api2.0/v1';
const TIMEOUT=10000;
const MIN_LAUNCH_INVENTORY=5;
let tokenCache={value:'',expiresAt:0};

async function token(){
  // Static tokens are a fallback only: they can expire while search continues to work.
  if(tokenCache.value && Date.now()<tokenCache.expiresAt)return tokenCache.value;
  const apiKey=String(process.env.CJ_API_KEY||'');
  if(!apiKey){
    if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
    throw Error('CJ_API_KEY is not configured');
  }
  const r=await fetch(BASE+'/authentication/getAccessToken',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({apiKey}),signal:AbortSignal.timeout(TIMEOUT)
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error('CJ auth failed');
  const expiry=Date.parse(j.data.accessTokenExpiryDate||j.data.accessTokenExpiry||'');
  tokenCache={value:j.data.accessToken,expiresAt:Number.isFinite(expiry)?Math.max(Date.now(),expiry-600000):Date.now()+30*60*1000};
  return tokenCache.value;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const vid=String(req.query?.vid||'').trim();
  if(!/^(?:\d{10,25}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(vid))return res.status(400).json({ok:false,error:'Invalid CJ variant id'});
  try{
    const u=new URL(BASE+'/product/stock/queryByVid');u.searchParams.set('vid',vid);
    const r=await fetch(u,{headers:{'CJ-Access-Token':await token()},signal:AbortSignal.timeout(TIMEOUT)});
    const j=await r.json().catch(()=>({}));
    if(r.status===429)return res.status(429).json({ok:false,code:'CJ_STOCK_RATE_LIMITED',upstreamStatus:429,error:'CJ stock rate limited'});
    if(r.status===401||r.status===403)return res.status(503).json({ok:false,code:'CJ_STOCK_AUTH_REJECTED',upstreamStatus:r.status,error:'CJ stock authorization rejected'});
    if(!r.ok)return res.status(503).json({ok:false,code:'CJ_STOCK_UPSTREAM_HTTP_ERROR',upstreamStatus:r.status,error:'CJ stock request failed'});
    const checked=validateCJStockResponse(j);
    if(!checked.ok)return res.status(409).json({ok:false,code:j?.result===false?'CJ_STOCK_UPSTREAM_REJECTED':'CJ_STOCK_RESPONSE_UNVERIFIED',upstreamStatus:r.status,error:'CJ stock response could not be verified',reason:checked.reason,inventoryVerified:false});
    if(!Number.isSafeInteger(checked.total)||checked.total<0||checked.total>1000000)return res.status(409).json({ok:false,error:'CJ stock total is outside safe bounds'});
    return res.status(200).json({ok:true,readOnly:true,vid,verifiedInventory:checked.total,factoryStockQuantity:checked.factoryTotal,recommendationStockStatus:checked.recommendationStockStatus,launchEligible:checked.total>=MIN_LAUNCH_INVENTORY,minimumLaunchInventory:MIN_LAUNCH_INVENTORY,verifiedAt:new Date().toISOString()});
  }catch{
    return res.status(503).json({ok:false,error:'CJ stock verification failed'});
  }
}
