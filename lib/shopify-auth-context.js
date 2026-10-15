import crypto from 'node:crypto';
import { loadShopifySession } from './shopify-session-store.js';

export function parseCookies(req){
  return Object.fromEntries(String(req.headers?.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}));
}
function signingKey(){
  const raw=String(process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY||'');
  if(!/^[0-9a-fA-F]{64}$/.test(raw))throw Error('Shopify session signing is not configured');
  return crypto.createHash('sha256').update('ai-buyer-browser-session-v1:').update(Buffer.from(raw,'hex')).digest();
}
export function createShopifyBrowserSession(shop,maxAgeSeconds=60*60*24*30){
  const normalized=String(shop||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized))throw Error('Invalid Shopify shop');
  const exp=Math.floor(Date.now()/1000)+maxAgeSeconds;
  const payload=Buffer.from(JSON.stringify({v:1,shop:normalized,exp}),'utf8').toString('base64url');
  const sig=crypto.createHmac('sha256',signingKey()).update(payload).digest('base64url');
  return payload+'.'+sig;
}
export function verifyShopifyBrowserSession(value){
  try{
    const [payload,sig,extra]=String(value||'').split('.');
    if(!payload||!sig||extra)return null;
    const expected=crypto.createHmac('sha256',signingKey()).update(payload).digest('base64url');
    const a=Buffer.from(sig),b=Buffer.from(expected);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
    const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if(parsed?.v!==1||!Number.isInteger(parsed.exp)||parsed.exp<Math.floor(Date.now()/1000))return null;
    const shop=String(parsed.shop||'').toLowerCase();
    return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)?shop:null;
  }catch{return null}
}
export async function getShopifyAuthContext(req,{allowAdminKey=true}={}){
  const allowed=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(allowed))return {ok:false,status:503,error:'Shopify allowed shop is not configured'};
  const adminKey=String(process.env.AI_BUYER_ADMIN_KEY||'');
  const serverAuthorized=Boolean(allowAdminKey&&adminKey&&req.headers?.authorization==='Bearer '+adminKey);
  const cookies=parseCookies(req);
  const browserShop=verifyShopifyBrowserSession(cookies.shopify_session);
  if(!serverAuthorized){
    if(browserShop&&browserShop!==allowed)return {ok:false,status:403,error:'Shopify shop is not authorized'};
    if(browserShop!==allowed)return {ok:false,status:401,authRequired:true,error:'Shopify認証が必要です'};
  }
  let token=String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||'').trim();
  if(!token){try{token=String(await loadShopifySession(allowed)||'');}catch{}}
  if(!token)return {ok:false,status:503,authRequired:true,error:'Shopifyサーバー認証がありません。Shopifyを再接続してください'};
  return {ok:true,shop:allowed,token,serverAuthorized};
}
