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
    let cursor='0';const found=[];let scanned=0;let truncated=false;
    do{
      const result=await call(['SCAN',cursor,'MATCH','ai-buyer:cj-sandbox:*','COUNT','100']);
      if(!Array.isArray(result)||result.length!==2)throw Error('Unexpected scan result');
      cursor=String(result[0]);
      const keys=Array.isArray(result[1])?result[1]:[];
      for(const key of keys){
        if(found.length>=100){truncated=true;break;}
        const state=await call(['GET',key]);
        if(state==='reserved'||String(state||'').startsWith('needs_review:')){
          // Hash only; never expose order IDs, customer details or Redis credentials.
          found.push({keyHash:crypto.createHash('sha256').update(key).digest('hex').slice(0,16),status:'needs_review',reason:state==='reserved'?'result_unconfirmed':'cj_result_ambiguous'});
        }
      }
      scanned+=keys.length;
    }while(cursor!=='0'&&scanned<1000&&!truncated);
    if(scanned>=1000||found.length>=100)truncated=true;
    return res.status(200).json({ok:true,orders:found,partial:cursor!=='0'||truncated,scanned,sandbox:true,automaticRetry:false});
  }catch{return res.status(503).json({ok:false,error:'Reconciliation queue unavailable'});}
}
