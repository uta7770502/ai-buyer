import {validateCJStockResponse} from '../cj-stock-validation.js';

const BASE='https://developers.cjdropshipping.com/api2.0/v1';
const TIMEOUT=10000;
const MIN_LAUNCH_INVENTORY=10;

async function token(){
  if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
  const apiKey=String(process.env.CJ_API_KEY||'');
  if(!apiKey)throw Error('CJ_API_KEY is not configured');
  const r=await fetch(BASE+'/authentication/getAccessToken',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({apiKey}),signal:AbortSignal.timeout(TIMEOUT)
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error('CJ auth failed');
  return j.data.accessToken;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const vid=String(req.query?.vid||'').trim();
  if(!/^\d{10,25}$/.test(vid))return res.status(400).json({ok:false,error:'Invalid CJ variant id'});
  try{
    const u=new URL(BASE+'/product/stock/queryByVid');u.searchParams.set('vid',vid);
    const r=await fetch(u,{headers:{'CJ-Access-Token':await token()},signal:AbortSignal.timeout(TIMEOUT)});
    const j=await r.json().catch(()=>({}));
    if(r.status===429)return res.status(429).json({ok:false,error:'CJ stock rate limited'});
    if(!r.ok)return res.status(503).json({ok:false,error:'CJ stock request failed'});
    const checked=validateCJStockResponse(j);
    if(!checked.ok)return res.status(409).json({ok:false,error:'CJ stock response could not be verified',reason:checked.reason});
    if(!Number.isSafeInteger(checked.total)||checked.total<0||checked.total>1000000)return res.status(409).json({ok:false,error:'CJ stock total is outside safe bounds'});
    return res.status(200).json({ok:true,readOnly:true,vid,verifiedInventory:checked.total,launchEligible:checked.total>=MIN_LAUNCH_INVENTORY,minimumLaunchInventory:MIN_LAUNCH_INVENTORY,verifiedAt:new Date().toISOString()});
  }catch{
    return res.status(503).json({ok:false,error:'CJ stock verification failed'});
  }
}
