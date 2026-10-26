import crypto from 'node:crypto';
import { previewStorageKey } from './preview-storage-key.js';

const KEY='ai-buyer:oddly:legal-config:v1';

function baseKey(){
  const raw=String(process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY||'');
  if(!/^[0-9a-fA-F]{64}$/.test(raw))throw Error('Legal config encryption is not configured');
  return Buffer.from(raw,'hex');
}
function encryptionKey(){
  return crypto.createHash('sha256').update(baseKey()).update('ODDLY_LEGAL_CONFIG_V1').digest();
}
function redisConfig(){
  const url=String(process.env.UPSTASH_REDIS_REST_URL||'').replace(/\/$/,'');
  const token=String(process.env.UPSTASH_REDIS_REST_TOKEN||'');
  if(!/^https:\/\//.test(url)||!token)throw Error('Legal config storage is unavailable');
  return {url,token};
}
async function redis(command){
  const {url,token}=redisConfig();
  const r=await fetch(url+'/',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Legal config storage unavailable');
  const j=await r.json();
  if(j.error)throw Error('Legal config storage rejected request');
  return j.result;
}
export async function saveLegalConfig(value){
  const key=encryptionKey(),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const raw=JSON.stringify({...value,updatedAt:new Date().toISOString()});
  const encrypted=Buffer.concat([cipher.update(raw,'utf8'),cipher.final()]);
  const payload=JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')});
  if(await redis(['SET',previewStorageKey(KEY),payload])!=='OK')throw Error('Unable to persist legal config');
}
export async function loadLegalConfig(){
  const payload=await redis(['GET',previewStorageKey(KEY)]);
  if(payload===null)return null;
  const parsed=JSON.parse(payload);
  if(parsed.v!==1)throw Error('Unsupported legal config version');
  const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(parsed.iv,'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag,'base64'));
  const raw=Buffer.concat([decipher.update(Buffer.from(parsed.data,'base64')),decipher.final()]).toString('utf8');
  return JSON.parse(raw);
}
