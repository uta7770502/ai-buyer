import crypto from 'crypto';
function parseCookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
function safeShop(v){const s=String(v||'').toLowerCase();return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)?s:''}
function verifyHmac(query,secret){
  const msg=Object.keys(query)
    .filter(k=>k!=='hmac'&&k!=='signature')
    .sort()
    .map(k=>k+'='+String(Array.isArray(query[k])?query[k].join(','):query[k]))
    .join('&');
  const digest=crypto.createHmac('sha256',secret).update(msg).digest('hex');
  const a=Buffer.from(digest),b=Buffer.from(String(query.hmac||''));
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
export default async function handler(req,res){
  try{
    const clientId=String(process.env.SHOPIFY_CLIENT_ID||'').trim(),clientSecret=String(process.env.SHOPIFY_CLIENT_SECRET||'').trim();
    const missing=[];if(!clientId)missing.push('SHOPIFY_CLIENT_ID');if(!clientSecret)missing.push('SHOPIFY_CLIENT_SECRET');if(missing.length)throw Error('未設定: '+missing.join(', '));
    const shop=safeShop(req.query.shop),code=String(req.query.code||''),state=String(req.query.state||''),cookies=parseCookies(req);
    if(!shop||!code)throw Error('Shopifyからの認証情報が不足しています');
    if(!state||state!==cookies.shopify_oauth_state)throw Error('認証stateが一致しません');
    if(!verifyHmac(req.query,clientSecret))throw Error('Shopify署名を検証できません');
    const r=await fetch('https://'+shop+'/admin/oauth/access_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:clientId,client_secret:clientSecret,code})});
    const j=await r.json();
    if(!r.ok||!j.access_token)throw Error(j.error_description||j.error||'アクセストークン取得に失敗しました');
    const maxAge=60*60*24*365;
    const opts='Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge;
    res.setHeader('Set-Cookie',[
      'shopify_access_token='+encodeURIComponent(j.access_token)+'; '+opts,
      'shopify_connected_shop='+encodeURIComponent(shop)+'; '+opts,
      'shopify_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
    ]);
    return res.redirect(302,'/?shopify=connected');
  }catch(e){return res.status(400).send('Shopify接続エラー: '+String(e.message||e))}
}