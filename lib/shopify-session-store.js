import { redisConnection } from './redis-connection.js';
import crypto from 'node:crypto';
import { previewStorageKey } from './preview-storage-key.js';

// Encryption key must be a separately provisioned 32-byte random secret, encoded as 64 hex digits.
function encryptionKey(){
  const raw=String(process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY||'');
  if(!/^[0-9a-fA-F]{64}$/.test(raw))throw Error('Shopify token encryption is not configured');
  return Buffer.from(raw,'hex');
}
function redisConfig(){
  const url=String(redisConnection().url||'').replace(/\/$/,'');
  const token=String(redisConnection().token||'');
  if(!/^https:\/\//.test(url)||!token)throw Error('Secure Shopify session storage is unavailable');
  return {url,token};
}
function sessionKey(shop){
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))throw Error('Invalid Shopify shop');
  return previewStorageKey('ai-buyer:shopify:offline:'+crypto.createHash('sha256').update(shop).digest('hex'));
}
async function redis(command){
  const {url,token}=redisConfig();
  const r=await fetch(url+'/',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Shopify session storage unavailable');
  const j=await r.json();
  if(j.error)throw Error('Shopify session storage rejected request');
  return j.result;
}
export async function saveShopifySession(shop,accessToken){
  const key=encryptionKey();
  if(typeof accessToken!=='string'||!accessToken.trim())throw Error('Invalid Shopify access token');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(accessToken,'utf8'),cipher.final()]);
  const payload=JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')});
  if(await redis(['SET',sessionKey(shop),payload])!=='OK')throw Error('Unable to persist Shopify session');
}
export async function loadShopifySession(shop){
  const key=encryptionKey();
  const payload=await redis(['GET',sessionKey(shop)]);
  if(payload===null)return null;
  const parsed=JSON.parse(payload);
  if(parsed.v!==1)throw Error('Unsupported Shopify session version');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(parsed.iv,'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parsed.data,'base64')),decipher.final()]).toString('utf8');
}
