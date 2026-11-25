import crypto from 'node:crypto';

// A read-only CJ audit can establish recent SKU-level inventory evidence, not
// fulfillment readiness, synchronized Shopify quantities or publication approval.
const TTL_MS=15*60*1000;
function context(env){
  const shop=String(env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
  const branch=String(env.VERCEL_GIT_COMMIT_REF||'').trim();
  const key=String(env.SHOPIFY_TOKEN_ENCRYPTION_KEY||'');
  if(env.VERCEL_ENV!=='preview'||branch!=='safety-gate-20261024'||!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||! /^[a-f0-9]{64}$/i.test(key))return null;
  return {shop,branch,key};
}
function canonicalSkus(skus){
  if(!Array.isArray(skus)||skus.length<1||skus.length>100||!skus.every(s=>typeof s==='string'&&/^\d{10,25}$/.test(s))||new Set(skus).size!==skus.length)return null;
  return [...skus].sort();
}
function sign(payload,key){return crypto.createHmac('sha256',key).update('adps-cj-stock-evidence-v1:').update(payload).digest('hex')}
export function issueStockEvidence(rows,{env=process.env,now=Date.now()}={}){
  const c=context(env);
  if(!c||!Array.isArray(rows)||!rows.every(r=>r?.ok===true&&r.cjStockVerified===true&&Number.isSafeInteger(r.cjStockQuantity)&&r.cjStockQuantity>=0&&Number.isSafeInteger(r.factoryStockQuantity)&&r.factoryStockQuantity>=0))return null;
  const skus=canonicalSkus(rows.map(r=>r.sku));
  if(!skus)return null;
  const payload=Buffer.from(JSON.stringify({v:1,shop:c.shop,branch:c.branch,skus,at:now})).toString('base64url');
  return payload+'.'+sign(payload,c.key);
}
export function verifyStockEvidence(receipt,skus,{env=process.env,now=Date.now()}={}){
  const c=context(env),expected=canonicalSkus(skus);
  if(!c||!expected||typeof receipt!=='string'||receipt.length>6000)return false;
  try{
    const [payload,sig,extra]=receipt.split('.');
    if(!payload||extra!==undefined||!/^[a-f0-9]{64}$/.test(sig||''))return false;
    if(!crypto.timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(sign(payload,c.key),'hex')))return false;
    const p=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    return p.v===1&&p.shop===c.shop&&p.branch===c.branch&&Number.isSafeInteger(p.at)&&p.at<=now&&now-p.at<=TTL_MS&&JSON.stringify(p.skus)===JSON.stringify(expected);
  }catch{return false}
}
