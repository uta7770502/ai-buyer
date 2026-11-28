import { getShopifyAuthContext } from '../shopify-auth-context.js';
const VERSION='2026-10';

async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{
    method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},
    body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(10000)
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify API request failed');
  return j.data;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const auth=await getShopifyAuthContext(req);
  if(!auth.ok)return res.status(auth.status).json({ok:false,error:auth.error,authRequired:Boolean(auth.authRequired)});
  let base=String(process.env.SHOPIFY_WEBHOOK_BASE_URL||'').trim().replace(/\/$/,'');
  // This timeout-fix Preview is temporary. Its branch-scoped environment does
  // not own the canonical ORDERS_PAID webhook. Audit against the already
  // verified safety-gate Preview origin instead of registering another webhook.
  if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(base)&&
     process.env.VERCEL_ENV==='preview'&&
     process.env.VERCEL_GIT_COMMIT_REF==='fix/prelaunch-audit-timeout-20261123'){
    base='https://adps-git-safety-gate-20261024-diogolf.vercel.app';
  }
  if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(base))return res.status(503).json({ok:false,error:'Invalid SHOPIFY_WEBHOOK_BASE_URL'});
  const expected=base+'/api/shopify-order-webhook';
  try{
    const all=[];let after=null,hasNext=true;
    for(let page=0;page<10&&hasNext;page++){
      const d=await gql(auth.shop,auth.token,'query($after:String){ webhookSubscriptions(first:50,after:$after,topics:[ORDERS_PAID]){ nodes{id topic uri} pageInfo{hasNextPage endCursor} } }',{after});
      const c=d.webhookSubscriptions;
      if(!Array.isArray(c?.nodes)||!c.pageInfo)throw Error('Webhook list unavailable');
      all.push(...c.nodes);
      hasNext=Boolean(c.pageInfo.hasNextPage);
      after=c.pageInfo.endCursor||null;
    }
    if(hasNext)return res.status(409).json({ok:false,partial:true,error:'Webhook list is larger than audit limit'});
    const keep=all.filter(x=>x.topic==='ORDERS_PAID'&&x.uri===expected);
    const stale=all.filter(x=>x.topic==='ORDERS_PAID'&&x.uri!==expected);
    return res.status(200).json({
      ok:true,readOnly:true,topic:'ORDERS_PAID',expectedUri:expected,
      exactCount:keep.length,staleCount:stale.length,
      ready:keep.length===1&&stale.length===0,
      duplicateExact:keep.length>1,
      keep:keep.map(x=>({id:x.id,uri:x.uri})),
      deleteCandidates:stale.map(x=>({id:x.id,uri:x.uri})),
      mutationPerformed:false,
      next:stale.length?'Review deleteCandidates before any cleanup':'No cleanup required'
    });
  }catch{
    return res.status(503).json({ok:false,error:'Unable to audit ORDERS_PAID webhooks'});
  }
}
