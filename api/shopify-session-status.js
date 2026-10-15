import { loadShopifySession } from '../lib/shopify-session-store.js';

function authorized(req){
  const expected=String(process.env.AI_BUYER_ADMIN_KEY||'').trim();
  const raw=String(req.headers?.authorization||'');
  return Boolean(expected&&raw===`Bearer ${expected}`);
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  if(!authorized(req))return res.status(401).json({ok:false,error:'Unauthorized'});
  const shop=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))return res.status(503).json({ok:false,configured:false,stored:false,verified:false});
  try{
    const token=await loadShopifySession(shop);
    if(!token)return res.status(200).json({ok:true,configured:true,stored:false,verified:false});
    const endpoint='https://'+shop+'/admin/api/2026-10/graphql.json';
    const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query:'query SessionStatus { shop { id name } }'}),signal:AbortSignal.timeout(5000)});
    const j=await r.json().catch(()=>({}));
    const verified=Boolean(r.ok&&!j.errors?.length&&j.data?.shop?.id);
    return res.status(200).json({ok:true,configured:true,stored:true,verified});
  }catch{
    return res.status(200).json({ok:true,configured:true,stored:false,verified:false});
  }
}
