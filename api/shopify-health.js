const VERSION='2026-10';
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},
    body:JSON.stringify({query,variables}),
    signal:AbortSignal.timeout(10000)
  });
  let j={};
  try{j=await r.json()}catch{}
  if(!r.ok||j.errors?.length){
    const e=new Error(j.errors?.[0]?.message||'Shopify API request failed');
    e.status=r.status;
    throw e;
  }
  return j.data;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const c=cookies(req),token=String(c.shopify_access_token||''),shop=String(c.shopify_connected_shop||'').toLowerCase();
    if(!token||!shop)return res.status(401).json({ok:false,authRequired:true,error:'Shopify認証が必要です'});
    const allowed=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
    if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(allowed)||shop!==allowed)return res.status(403).json({ok:false,error:'Shopify shop is not authorized'});
    const webhookBase=String(process.env.SHOPIFY_WEBHOOK_BASE_URL||'').trim().replace(/\/$/,'');
    if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(webhookBase))return res.status(500).json({ok:false,error:'SHOPIFY_WEBHOOK_BASE_URL must be a valid HTTPS origin'});
    const expectedWebhookUri=webhookBase+'/api/shopify-order-webhook';
    const started=Date.now();

    const base=await gql(shop,token,'query { shop { name myshopifyDomain } currentAppInstallation { accessScopes { handle } } publications(first:5) { nodes { id name } } }');
    if(!base?.shop)throw Error('Shopify接続に失敗しました');

    const paidWebhooks=[];let after=null,hasNextPage=true;
    for(let page=0;page<10&&hasNextPage;page++){
      const data=await gql(shop,token,'query($after:String) { webhookSubscriptions(first:50, after:$after, topics:[ORDERS_PAID]) { nodes { id topic uri } pageInfo { hasNextPage endCursor } } }',{after});
      const connection=data.webhookSubscriptions;
      if(!Array.isArray(connection?.nodes)||!connection.pageInfo)throw Error('Webhook一覧を確認できませんでした');
      paidWebhooks.push(...connection.nodes);
      hasNextPage=connection.pageInfo.hasNextPage;
      if(hasNextPage&&(!connection.pageInfo.endCursor||connection.pageInfo.endCursor===after))throw Error('Webhook一覧の続きが取得できません');
      after=connection.pageInfo.endCursor;
    }
    if(hasNextPage)return res.status(409).json({ok:false,partial:true,error:'Webhookが多いため全件確認できません。Shopify管理画面で確認してください'});

    const scopes=(base.currentAppInstallation?.accessScopes||[]).map(x=>x.handle);
    const required=['read_products','write_products','read_publications','write_publications','read_orders','write_orders','read_merchant_managed_fulfillment_orders','write_merchant_managed_fulfillment_orders'];
    const missingScopes=required.filter(x=>!scopes.includes(x));
    const fulfillmentScopesReady=missingScopes.filter(x=>x.includes('fulfillment_orders')).length===0;
    const fulfillmentSyncOptIn=process.env.SHOPIFY_FULFILLMENT_SYNC_ENABLED==='true';
    const hasExactOrdersPaidWebhook=paidWebhooks.some(x=>x.topic==='ORDERS_PAID'&&x.uri===expectedWebhookUri);
    const staleOrdersPaidWebhooks=paidWebhooks.filter(x=>x.topic==='ORDERS_PAID'&&x.uri!==expectedWebhookUri).map(x=>({id:x.id,uri:x.uri}));
    const ordersPaidWebhookReady=hasExactOrdersPaidWebhook&&staleOrdersPaidWebhooks.length===0;
    return res.status(200).json({
      ok:true,configured:true,
      shop:base.shop.name,domain:base.shop.myshopifyDomain,
      latencyMs:Date.now()-started,checkedAt:new Date().toISOString(),
      scopes,missingScopes,
      publicationCount:(base.publications?.nodes||[]).length,
      publicationNames:(base.publications?.nodes||[]).map(x=>x.name),
      fulfillmentScopesReady,fulfillmentSyncOptIn,
      fulfillmentSyncReady:fulfillmentScopesReady&&fulfillmentSyncOptIn,
      ordersPaidWebhookReady,hasExactOrdersPaidWebhook,expectedWebhookUri,staleOrdersPaidWebhooks
    });
  }catch(e){
    const authRequired=e?.status===401||e?.status===403||/unauthorized|access token|authentication/i.test(String(e?.message||''));
    return res.status(authRequired?401:503).json({ok:false,authRequired,error:authRequired?'Shopify再認証が必要です':e.message||'Shopify状態を確認できません'});
  }
}
