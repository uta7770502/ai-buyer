import cjHealth from '../lib/routes/cj-health.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const isAllowed = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'safety-gate-20261024';
  if(!isAllowed) return res.status(404).json({ok:false});
  const originalJson = res.json.bind(res);
  res.json = payload => originalJson(payload?.ok===true ? {ok:true,latencyMs:payload.latencyMs||null,checkedAt:payload.checkedAt||null} : {ok:false,error:'CJ connectivity check failed'});
  return cjHealth(req,res);
}
