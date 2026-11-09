import {redisConnection} from './redis-connection.js';

// Trusted server-side lookup. Never accept an approval record from the browser.
export async function loadMarginException(vid,{now=Date.now(),fetcher=fetch}={}){
 const id=String(vid||'');
 if(!/^\d{10,25}$/.test(id))return null;
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='safety-gate-20261024')return null;
 const {url,token}=redisConnection();
 if(!url||!token)return null;
 try{
  const response=await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(['GET','adps:margin-exception:v1:'+id]),signal:AbortSignal.timeout(8000)});
  if(!response.ok)return null;
  const payload=await response.json();
  if(payload.error||typeof payload.result!=='string')return null;
  const record=JSON.parse(payload.result);
  const approvedAt=Date.parse(record?.approvedAt||'');
  if(record?.approved!==true||record.source!=='product-specific-owner-approval'||record.vid!==id||![20,25].includes(record.threshold)||!Number.isFinite(approvedAt)||approvedAt>now||now-approvedAt>30*86400000||typeof record.approvalId!=='string'||!/^[-a-zA-Z0-9_]{12,100}$/.test(record.approvalId))return null;
  return {approved:true,source:'product-specific-owner-approval',vid:id,threshold:record.threshold,approvedAt:record.approvedAt,approvalId:record.approvalId};
 }catch{return null;}
}
