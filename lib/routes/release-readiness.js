export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=process.env.AI_BUYER_ADMIN_KEY;
  if(!admin||req.headers.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});

  const checks={
    shopifyClientSecret:Boolean(process.env.SHOPIFY_CLIENT_SECRET),
    shopifyClientId:Boolean(process.env.SHOPIFY_CLIENT_ID),
    shopifyStorefrontToken:Boolean(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN),
    shopifyShopMatchesAllowed:(()=>{
      const shop=String(process.env.SHOPIFY_SHOP||'').trim().replace(/\.myshopify\.com$/i,'').toLowerCase();
      const allowed=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
      return /^[a-z0-9][a-z0-9-]*$/.test(shop)&&shop+'.myshopify.com'===allowed;
    })(),
    shopifyAllowedShop:/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase()),
    webhookBaseUrlConfigured:Boolean(String(process.env.SHOPIFY_WEBHOOK_BASE_URL||'').trim()),
    webhookBaseUrlValid:/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(String(process.env.SHOPIFY_WEBHOOK_BASE_URL||'').replace(/\/$/,'')),
    cjCredentials:Boolean(process.env.CJ_ACCESS_TOKEN||process.env.CJ_API_KEY),
    redisConfigured:Boolean(process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN),
    cjSandboxEnabled:process.env.CJ_SANDBOX_ORDER_ENABLED==='true',
    fulfillmentSyncEnabled:process.env.SHOPIFY_FULFILLMENT_SYNC_ENABLED==='true',
    liveShopifyPublishEnabled:process.env.SHOPIFY_LIVE_PUBLISH_ENABLED==='true',
    realShopifyOrdersAllowedInSandbox:process.env.CJ_ALLOW_REAL_SHOPIFY_ORDERS_IN_SANDBOX==='true',
    maxItems:/^[1-9]\d*$/.test(String(process.env.CJ_MAX_ITEMS_PER_ORDER||''))&&Number.isSafeInteger(Number(process.env.CJ_MAX_ITEMS_PER_ORDER)),
    maxOrderValue:String(process.env.CJ_MAX_ORDER_VALUE||'').trim()!==''&&Number.isFinite(Number(process.env.CJ_MAX_ORDER_VALUE))&&Number(process.env.CJ_MAX_ORDER_VALUE)>0,
    maxFreightUsd:String(process.env.CJ_MAX_FREIGHT_USD||'').trim()!==''&&Number.isFinite(Number(process.env.CJ_MAX_FREIGHT_USD))&&Number(process.env.CJ_MAX_FREIGHT_USD)>0,
    limitCurrency:/^[A-Z]{3}$/.test(String(process.env.CJ_ORDER_LIMIT_CURRENCY||'').toUpperCase())
  };

  // Diagnostic endpoint is read-only: never contact payment, fulfillment or advertising APIs.
  let shopifyAdminVerified=false,cjApiVerified=false,redisReachable=false;
  if(checks.shopifyAllowedShop&&process.env.SHOPIFY_ADMIN_ACCESS_TOKEN){
    try{
      const shop=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
      const r=await fetch('https://'+shop+'/admin/api/2026-10/graphql.json',{
        method:'POST',
        headers:{'Content-Type':'application/json','X-Shopify-Access-Token':process.env.SHOPIFY_ADMIN_ACCESS_TOKEN},
        body:JSON.stringify({query:'query ReadinessShop { shop { id name } }'}),
        signal:AbortSignal.timeout(5000)
      });
      const j=await r.json();
      shopifyAdminVerified=Boolean(r.ok&&!j.errors?.length&&j.data?.shop?.id);
    }catch{}
  }
  if(checks.cjCredentials){
    try{
      let token=String(process.env.CJ_ACCESS_TOKEN||'').trim();
      if(!token&&process.env.CJ_API_KEY){
        const ar=await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({apiKey:process.env.CJ_API_KEY}),
          signal:AbortSignal.timeout(5000)
        });
        const aj=await ar.json();
        if(ar.ok&&aj?.result===true&&aj?.data?.accessToken)token=String(aj.data.accessToken);
      }
      if(token){
        const cr=await fetch('https://developers.cjdropshipping.com/api2.0/v1/product/getCategory',{
          headers:{'CJ-Access-Token':token},
          signal:AbortSignal.timeout(5000)
        });
        const cj=await cr.json();
        cjApiVerified=Boolean(cr.ok&&cj?.result===true);
      }
    }catch{}
  }
  let redisReachable=false;
  if(checks.redisConfigured){
    try{
      const base=process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/,'');
      const r=await fetch(base+'/ping',{headers:{Authorization:'Bearer '+process.env.UPSTASH_REDIS_REST_TOKEN},signal:AbortSignal.timeout(4000)});
      const j=await r.json();
      redisReachable=r.ok&&j.result==='PONG';
    }catch{}
  }

  const storefrontReady=
    checks.shopifyAllowedShop&&
    checks.shopifyStorefrontToken&&
    checks.webhookBaseUrlConfigured&&
    checks.webhookBaseUrlValid;

  const sandboxOrderReady=
    checks.shopifyClientId&&
    checks.shopifyClientSecret&&
    checks.shopifyShopMatchesAllowed&&
    checks.shopifyAllowedShop&&
    checks.webhookBaseUrlConfigured&&
    checks.webhookBaseUrlValid&&
    checks.cjCredentials&&
    checks.redisConfigured&&
    redisReachable&&
    checks.cjSandboxEnabled&&
    checks.maxItems&&
    checks.maxOrderValue&&
    checks.maxFreightUsd&&
    checks.limitCurrency;

  const blockers=[];
  const warnings=[];
  if(!checks.shopifyClientSecret)blockers.push('SHOPIFY_CLIENT_SECRET');
  if(!checks.shopifyClientId)blockers.push('SHOPIFY_CLIENT_ID');
  if(!checks.shopifyShopMatchesAllowed)blockers.push('SHOPIFY_SHOP');
  if(!checks.shopifyAllowedShop)blockers.push('SHOPIFY_ALLOWED_SHOP_DOMAIN');
  if(!checks.webhookBaseUrlConfigured||!checks.webhookBaseUrlValid)blockers.push('SHOPIFY_WEBHOOK_BASE_URL');
  if(!checks.cjSandboxEnabled)blockers.push('CJ_SANDBOX_ORDER_ENABLED');
  if(!checks.fulfillmentSyncEnabled)blockers.push('SHOPIFY_FULFILLMENT_SYNC_ENABLED');
  if(!checks.cjCredentials)blockers.push('CJ credentials');
  if(!checks.redisConfigured||!redisReachable)blockers.push('Redis');
  if(!checks.maxItems)blockers.push('CJ_MAX_ITEMS_PER_ORDER');
  if(!checks.maxOrderValue)blockers.push('CJ_MAX_ORDER_VALUE');
  if(!checks.maxFreightUsd)blockers.push('CJ_MAX_FREIGHT_USD');
  if(!checks.limitCurrency)blockers.push('CJ_ORDER_LIMIT_CURRENCY');
  if(checks.realShopifyOrdersAllowedInSandbox)warnings.push('CJ_ALLOW_REAL_SHOPIFY_ORDERS_IN_SANDBOX is enabled');
  if(checks.liveShopifyPublishEnabled)warnings.push('SHOPIFY_LIVE_PUBLISH_ENABLED is enabled');
  if(!checks.shopifyStorefrontToken)warnings.push('SHOPIFY_STOREFRONT_ACCESS_TOKEN is not configured');
  if(!checks.fulfillmentSyncEnabled)warnings.push('SHOPIFY_FULFILLMENT_SYNC_ENABLED is disabled');
  if(checks.fulfillmentSyncEnabled&&!checks.redisConfigured)warnings.push('Fulfillment sync enabled without Redis');

  return res.status(200).json({
    ok:true,
    checkVersion:3,
    safetyContract:"sandbox-v1",
    checkedAt:new Date().toISOString(),
    verification:"read-only-connectivity",
    mode:"sandbox",
    checks,
    redisReachable,
    externalChecks:{redisPing:redisReachable,shopifyAdminVerified,cjApiVerified,shopifyWebhookVerified:false,fulfillmentVerified:false},
    storefrontReady,
    aioGeoAuditRequired:Boolean(checks.shopifyStorefrontToken&&checks.shopifyAllowedShop),
    aioGeoAuditEndpoint:'/api/storefront-products',
    sandboxOrderReady,
    fulfillmentSyncOptIn:checks.fulfillmentSyncEnabled,
    liveCjOrdersEnabled:false,
    readyForLive:false,
    liveIntegrationVerified:false,
    blockers,
    warnings,
    safeToTest:blockers.length===0&&sandboxOrderReady&&shopifyAdminVerified&&cjApiVerified&&checks.fulfillmentSyncEnabled&&!checks.realShopifyOrdersAllowedInSandbox&&!checks.liveShopifyPublishEnabled&&warnings.length===0,
    note:"SafeToTest now verifies read-only Shopify Admin, CJ API and Redis connectivity. Webhook delivery and fulfillment still require sandbox evidence. No live order, fulfillment, payment, publication or advertising action was performed."
  });
}
