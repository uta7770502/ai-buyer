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
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
  if(!admin||String(req.headers?.authorization||'')!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  const allowed=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='fix/prelaunch-audit-timeout-20261123';
  if(!allowed)return res.status(404).json({ok:false});
  const auth=await getShopifyAuthContext(req);
  if(!auth.ok)return res.status(auth.status).json({ok:false,error:auth.error});
  const expected='https://adps-git-safety-gate-20261024-diogolf.vercel.app/api/shopify-order-webhook';
  const all=[];let after=null,hasNext=true;
  for(let page=0;page<10&&hasNext;page++){
    const d=await gql(auth.shop,auth.token,'query($after:String){ webhookSubscriptions(first:50,after:$after,topics:[ORDERS_PAID]){ nodes{id topic uri} pageInfo{hasNextPage endCursor} } }',{after});
    const c=d.webhookSubscriptions;
    if(!Array.isArray(c?.nodes)||!c.pageInfo)return res.status(503).json({ok:false,error:'Webhook list unavailable'});
    all.push(...c.nodes);hasNext=Boolean(c.pageInfo.hasNextPage);after=c.pageInfo.endCursor||null;
  }
  if(hasNext)return res.status(409).json({ok:false,partial:true,error:'Webhook list exceeds audit limit'});
  const keep=all.filter(x=>x.topic==='ORDERS_PAID'&&x.uri===expected);
  const stale=all.filter(x=>x.topic==='ORDERS_PAID'&&x.uri!==expected);
  if(keep.length!==1)return res.status(409).json({ok:false,error:'Expected exactly one canonical ORDERS_PAID webhook',exactCount:keep.length,staleCount:stale.length});
  const allowedUris=new Set([
    'https://ai-buyer-nine.vercel.app/api/shopify-order-webhook',
    'https://ai-buyer-git-safety-gate-20261024-diogolf.vercel.app/api/shopify-order-webhook'
  ]);
  const unexpected=stale.filter(x=>!allowedUris.has(x.uri));
  if(unexpected.length)return res.status(409).json({ok:false,error:'Unexpected stale webhook found; cleanup aborted',unexpected:unexpected.map(x=>({id:x.id,uri:x.uri}))});
  const deleted=[];
  for(const x of stale){
    const d=await gql(auth.shop,auth.token,'mutation($id:ID!){ webhookSubscriptionDelete(id:$id){ deletedWebhookSubscriptionId userErrors{field message} } }',{id:x.id});
    const out=d.webhookSubscriptionDelete;
    if(out?.userErrors?.length||!out?.deletedWebhookSubscriptionId){
      return res.status(503).json({ok:false,error:'Webhook cleanup failed',deleted,failed:{id:x.id,uri:x.uri}});
    }
    deleted.push({id:x.id,uri:x.uri});
  }
  return res.status(200).json({ok:true,deletedCount:deleted.length,deleted,kept:keep.map(x=>({id:x.id,uri:x.uri})),expectedUri:expected});
}