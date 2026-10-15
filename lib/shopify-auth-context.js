import { loadShopifySession } from './shopify-session-store.js';

export function parseCookies(req){
  return Object.fromEntries(String(req.headers?.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}));
}
export async function getShopifyAuthContext(req,{allowAdminKey=true}={}){
  const allowed=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(allowed))return {ok:false,status:503,error:'Shopify allowed shop is not configured'};
  const adminKey=String(process.env.AI_BUYER_ADMIN_KEY||'');
  const serverAuthorized=Boolean(allowAdminKey&&adminKey&&req.headers?.authorization==='Bearer '+adminKey);
  const cookies=parseCookies(req);
  const browserShop=String(cookies.shopify_connected_shop||'').trim().toLowerCase();
  if(!serverAuthorized&&browserShop!==allowed)return {ok:false,status:401,authRequired:true,error:'Shopify認証が必要です'};
  let token='';
  try{token=String(await loadShopifySession(allowed)||'');}catch{}
  if(!token)return {ok:false,status:503,authRequired:true,error:'Shopifyサーバー認証がありません。Shopifyを再接続してください'};
  return {ok:true,shop:allowed,token,serverAuthorized};
}
