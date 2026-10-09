import crypto from 'node:crypto';

// Read-only reconciliation queue for CJ sandbox orders.
// Uses SCAN rather than KEYS to avoid blocking Redis.
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=process.env.AI_BUYER_ADMIN_KEY;
  if(!admin||req.headers.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  const url=process.env.UPSTASH_REDIS_REST_URL,token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token)return res.status(503).json({ok:false,error:'Order store not configured'});
  const call=async cmd=>{
    const r=await fetch(url.replace(/\/$/,'')+'/',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(cmd),signal:AbortSignal.timeout(5000)});
    if(!r.ok)throw Error('Order store unavailable');
    const j=await r.json();if(j.error)throw Error('Order store rejected query');return j.result;
  };
  try{
    const kind=['fulfillment','simulation'].includes(req.query?.kind)?req.query.kind:'cj';
    const prefix=kind==='fulfillment'?'ai-buyer:fulfillment-sync:':kind==='simulation'?'ai-buyer:sandbox-simulation:':'ai-buyer:cj-sandbox:';
    const requestedCursor=String(req.query?.cursor||'0');
    if(!/^\d{1,30}$/.test(requestedCursor))return res.status(400).json({ok:false,error:'Invalid reconciliation cursor'});
    // One bounded page per request; MGET avoids hundreds of sequential round trips.
    const page=await call(['SCAN',requestedCursor,'MATCH',prefix+'*','COUNT','100']);
    if(!Array.isArray(page)||page.length!==2||!/^\d+$/.test(String(page[0]))||!Array.isArray(page[1]))throw Error('Unexpected scan result');
    const cursor=String(page[0]);
    const keys=[...new Set(page[1])];
    if(keys.some(key=>typeof key!=='string'||!key.startsWith(prefix)))throw Error('Unexpected scan key');
    const found=[];
    const reasons={
      reserved:'result_unconfirmed',
      'needs_review:simulation_result_ambiguous':'simulation_result_ambiguous',
      'needs_review:unknown_cj_result':'cj_result_ambiguous',
      'needs_review:cj_rejected':'cj_rejected',
      'needs_review:missing_cj_order_id':'missing_cj_order_id',
      'needs_review:unknown_shopify_result':'shopify_result_ambiguous',
      'needs_review:shopify_rejected':'shopify_rejected'
    };
    // COUNT is only a Redis hint. Do not silently drop an oversized page.
    if(keys.length>1000)return res.status(503).json({ok:false,partial:true,error:'Reconciliation page too large; manual inspection required'});
    for(let offset=0;offset<keys.length;offset+=100){
      const batch=keys.slice(offset,offset+100),states=await call(['MGET',...batch]);
      if(!Array.isArray(states)||states.length!==batch.length)throw Error('Unexpected state response');
      states.forEach((state,i)=>{
        if(state==='reserved'||String(state||'').startsWith('needs_review:')){
          found.push({keyHash:crypto.createHash('sha256').update(batch[i]).digest('hex').slice(0,16),status:'needs_review',reason:reasons[state]||'result_ambiguous',kind});
        }
      });
    }
    return res.status(200).json({ok:true,orders:found,partial:cursor!=='0',nextCursor:cursor,scanned:keys.length,pages:1,kind,sandbox:true,automaticRetry:false});
  }catch{return res.status(503).json({ok:false,error:'Reconciliation queue unavailable'});}
}
