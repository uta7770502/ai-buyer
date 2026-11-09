import crypto from 'node:crypto';
import {redisConnection} from '../lib/redis-connection.js';

const isVid=v=>/^\d{10,25}$/.test(String(v||''));
const keyFor=vid=>'adps:margin-exception:v1:'+vid;
const authorized=req=>{
 const secret=String(process.env.AI_BUYER_ADMIN_KEY||'');
 const received=Buffer.from(String(req.headers?.authorization||''));
 const expected=Buffer.from('Bearer '+secret);
 return Boolean(secret&&received.length===expected.length&&crypto.timingSafeEqual(received,expected));
};
async function redis(command){
 const {url,token}=redisConnection();
 if(!url||!token)throw Error('redis-unavailable');
 const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(8000)});
 const data=await response.json();
 if(!response.ok||data.error)throw Error('redis-operation-failed');
 return data.result;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='safety-gate-20261024')return res.status(404).json({ok:false});
 if(!['GET','POST','DELETE'].includes(req.method))return res.status(405).json({ok:false,error:'method-not-allowed'});
 if(!authorized(req))return res.status(401).json({ok:false,error:'admin-required'});
 const vid=String(req.method==='GET'?req.query?.vid:req.body?.vid||'');
 if(!isVid(vid))return res.status(400).json({ok:false,error:'invalid-vid'});
 try{
  if(req.method==='GET'){
   const raw=await redis(['GET',keyFor(vid)]);
   if(!raw)return res.status(200).json({ok:true,approved:false,vid});
   const record=JSON.parse(raw);
   if(record.vid!==vid||record.approved!==true||![20,25].includes(record.threshold)||!Number.isFinite(Date.parse(record.approvedAt))||Date.parse(record.approvedAt)>Date.now()||Date.now()-Date.parse(record.approvedAt)>30*86400000)return res.status(200).json({ok:true,approved:false,vid});
   return res.status(200).json({ok:true,...record});
  }
  if(req.method==='DELETE'){
   await redis(['DEL',keyFor(vid)]);
   return res.status(200).json({ok:true,approved:false,vid});
  }
  const threshold=req.body?.threshold;
  if(threshold!==20&&threshold!==25)return res.status(400).json({ok:false,error:'invalid-exception-threshold'});
  if(req.body?.confirm!==true)return res.status(400).json({ok:false,error:'explicit-confirmation-required'});
  const record={approved:true,source:'product-specific-owner-approval',vid,threshold,approvedAt:new Date().toISOString(),approvalId:crypto.randomUUID()};
  await redis(['SET',keyFor(vid),JSON.stringify(record),'EX',30*86400]);
  return res.status(200).json({ok:true,...record});
 }catch{return res.status(503).json({ok:false,error:'approval-storage-unavailable'});}
}
