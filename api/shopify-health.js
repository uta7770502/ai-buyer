const VERSION='2026-10';
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const c=cookies(req),token=String(c.shopify_access_token||''),shop=String(c.shopify_connected_shop||'');
    if(!token||!shop)return res.status(401).json({ok:false,authRequired:true,error:'Shopify認証が必要です'});
    const allowed=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
    if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(allowed)||shop!==allowed)return res.status(403).json({ok:false,error:'Shopify shop is not authorized'});
    const started=Date.now();
    const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query:'query { shop { name myshopifyDomain } currentAppInstallation { accessScopes { handle } } publications(first:5) { nodes { id name } } webhookSubscriptions(first:50, topics:[ORDERS_PAID]) { nodes { id topic uri } } }'})});
    const j=await r.json();
    if(!r.ok||j.errors?.length||!j.data?.shop)throw Error(j.errors?.[0]?.message||'Shopify接続に失敗しました');
    const scopes=(j.data.currentAppInstallation?.accessScopes||[]).map(x=>x.handle);
    const required=['read_products','write_products','read_publications','write_publications','read_orders','write_orders','read_merchant_managed_fulfillment_orders','write_merchant_managed_fulfillment_orders'];
    const missingScopes=required.filter(x=>!scopes.includes(x));
    const fulfillmentScopesReady=missingScopes.filter(x=>x.includes('fulfillment_orders')).length===0;
    const fulfillmentSyncOptIn=process.env.SHOPIFY_FULFILLMENT_SYNC_ENABLED==='true';
    const webhookBase=String(process.env.SHOPIFY_WEBHOOK_BASE_URL||'https://ai-buyer-nine.vercel.app').replace(/\/$/,'');
    const expectedWebhookUri=webhookBase+'/api/shopify-order-webhook';
    const paidWebhooks=j.data.webhookSubscriptions?.nodes||[];
    const ordersPaidWebhookReady=paidWebhooks.some(x=>x.topic==='ORDERS_PAID'&&x.uri===expectedWebhookUri);
    const staleOrdersPaidWebhooks=paidWebhooks.filter(x=>x.topic==='ORDERS_PAID'&&x.uri!==expectedWebhookUri).map(x=>({id:x.id,uri:x.uri}));
    return res.status(200).json({ok:true,configured:true,shop:j.data.shop.name,domain:j.data.shop.myshopifyDomain,latencyMs:Date.now()-started,checkedAt:new Date().toISOString(),scopes,missingScopes,publicationCount:(j.data.publications?.nodes||[]).length,publicationNames:(j.data.publications?.nodes||[]).map(x=>x.name),fulfillmentScopesReady,fulfillmentSyncOptIn,fulfillmentSyncReady:fulfillmentScopesReady&&fulfillmentSyncOptIn,ordersPaidWebhookReady,expectedWebhookUri,staleOrdersPaidWebhooks});
  }catch(e){return res.status(401).json({ok:false,authRequired:true,error:e.message||'Shopify再認証が必要です'})}
}