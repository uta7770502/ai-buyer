const VERSION='2026-10';
let tokenCache={token:'',expiresAt:0};
function cfg(){
  const shop=String(process.env.SHOPIFY_SHOP||'').trim().replace(/\.myshopify\.com$/i,'');
  const clientId=String(process.env.SHOPIFY_CLIENT_ID||'').trim();
  const clientSecret=String(process.env.SHOPIFY_CLIENT_SECRET||'').trim();
  if(!shop||!clientId||!clientSecret)throw Error('Shopify環境変数が未設定です');
  return {shop,clientId,clientSecret};
}
async function getToken(){
  if(tokenCache.token&&Date.now()<tokenCache.expiresAt-60000)return tokenCache.token;
  const {shop,clientId,clientSecret}=cfg();
  const r=await fetch('https://'+shop+'.myshopify.com/admin/oauth/access_token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret})
  });
  const j=await r.json();
  if(!r.ok||!j.access_token)throw Error(j.error_description||j.error||'Shopifyトークン取得に失敗しました');
  tokenCache={token:j.access_token,expiresAt:Date.now()+Number(j.expires_in||86399)*1000};
  return tokenCache.token;
}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const {shop}=cfg(),started=Date.now(),token=await getToken();
    const r=await fetch('https://'+shop+'.myshopify.com/admin/api/'+VERSION+'/graphql.json',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},
      body:JSON.stringify({query:'query { shop { name myshopifyDomain } }'})
    });
    const j=await r.json();
    if(!r.ok||j.errors?.length||!j.data?.shop)throw Error(j.errors?.[0]?.message||'Shopify接続に失敗しました');
    return res.status(200).json({ok:true,configured:true,shop:j.data.shop.name,domain:j.data.shop.myshopifyDomain,latencyMs:Date.now()-started,checkedAt:new Date().toISOString()});
  }catch(e){return res.status(502).json({ok:false,configured:false,error:e.message||'Shopify接続に失敗しました'})}
}