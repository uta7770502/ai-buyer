import crypto from 'node:crypto';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const key=process.env.AI_BUYER_ADMIN_KEY;
  const authorization=req.headers?.authorization;
  const provided=typeof authorization==='string'&&authorization.startsWith('Bearer ')?authorization.slice(7):'';
  const expected=Buffer.from(String(key||''));
  const received=Buffer.from(provided);
  if(!key||expected.length!==received.length||!crypto.timingSafeEqual(expected,received))return res.status(401).json({ok:false,error:'Unauthorized'});
  const has=k=>Boolean(String(process.env[k]||'').trim());
  const shop=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
  const configured={
    shopifyMerchant:/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop),
    shopifyWebhookSecret:has('SHOPIFY_CLIENT_SECRET'),
    shopifyAdminToken:has('SHOPIFY_ADMIN_ACCESS_TOKEN'),
    cjAuthentication:has('CJ_ACCESS_TOKEN')||has('CJ_API_KEY'),
    durableRedis:has('UPSTASH_REDIS_REST_URL')&&has('UPSTASH_REDIS_REST_TOKEN'),
    orderLimits:/^[1-9]\d*$/.test(String(process.env.CJ_MAX_ITEMS_PER_ORDER||''))&&Number.isSafeInteger(Number(process.env.CJ_MAX_ITEMS_PER_ORDER))&&String(process.env.CJ_MAX_ORDER_VALUE||'').trim()!==''&&Number.isFinite(Number(process.env.CJ_MAX_ORDER_VALUE))&&Number(process.env.CJ_MAX_ORDER_VALUE)>0&&/^[A-Z]{3}$/.test(String(process.env.CJ_ORDER_LIMIT_CURRENCY||'')),
    freightLimit:String(process.env.CJ_MAX_FREIGHT_USD||'').trim()!==''&&Number.isFinite(Number(process.env.CJ_MAX_FREIGHT_USD))&&Number(process.env.CJ_MAX_FREIGHT_USD)>0,
    destinationCountry:/^[A-Z]{2}$/.test(String(process.env.CJ_ALLOWED_DESTINATION_COUNTRY||'JP')),
  };
  const readOnlyConfigured={cjCatalogRead:configured.cjAuthentication,shopifyCatalogRead:configured.shopifyMerchant&&(configured.shopifyAdminToken||has('SHOPIFY_TOKEN_ENCRYPTION_KEY'))};
  const readOnlyMissing=Object.entries(readOnlyConfigured).filter(([,ok])=>!ok).map(([name])=>name);
  const readOnlyStatus=readOnlyMissing.length?'configuration_incomplete':'awaiting_connectivity_verification';
  const readOnlyNextChecks=[
    {id:'cj-catalog-connectivity',label:'Verify CJ category API with read-only health endpoint',verified:false},
    {id:'cj-variant-inventory',label:'Verify inventory for each of nine CJ SKUs',verified:false},
    {id:'cj-japan-freight',label:'Verify shipping to Japan and landed cost for each variant',verified:false},
    {id:'shopify-draft-sku-match',label:'Verify live Shopify draft variants match CJ SKU mappings',verified:false}
  ];
  const flags={
    sandboxOrderEnabled:process.env.CJ_SANDBOX_ORDER_ENABLED==='true',
    sandboxTrackingSyncEnabled:process.env.CJ_SANDBOX_TRACKING_SYNC_ENABLED==='true'
  };
  const missing=Object.entries(configured).filter(([,ok])=>!ok).map(([name])=>name);
  const remediation={
    shopifyMerchant:'Set SHOPIFY_ALLOWED_SHOP_DOMAIN to the approved .myshopify.com domain',
    shopifyWebhookSecret:'Set SHOPIFY_CLIENT_SECRET to the Shopify app client secret',
    shopifyAdminToken:'Set SHOPIFY_ADMIN_ACCESS_TOKEN with the required Shopify Admin API permissions',
    cjAuthentication:'Set CJ_ACCESS_TOKEN or CJ_API_KEY',
    durableRedis:'Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN',
    orderLimits:'Set positive CJ_MAX_ITEMS_PER_ORDER (integer), CJ_MAX_ORDER_VALUE, and CJ_ORDER_LIMIT_CURRENCY (3-letter code)',
    freightLimit:'Set positive finite CJ_MAX_FREIGHT_USD',
    destinationCountry:'Set CJ_ALLOWED_DESTINATION_COUNTRY to a two-letter code (defaults to JP)'
  };
  const nextChecks=[
    {id:'shopify-webhook',label:'Confirm signed Shopify paid-order webhook reaches the deployed endpoint',verified:false},
    {id:'shopify-catalog',label:'Verify Shopify product variant and CJ SKU mapping against a test product',verified:false},
    {id:'cj-sandbox-order',label:'Place and reconcile one CJ sandbox order without live payment',verified:false},
    {id:'redis-deduplication',label:'Verify durable Redis order reservation survives duplicate delivery',verified:false},
    {id:'shopify-fulfillment',label:'Verify CJ tracking updates a Shopify test order once',verified:false}
  ];
  const readinessStatus=missing.length?'configuration_incomplete':'awaiting_live_verification';
  const summary={configuredChecks:Object.values(configured).filter(Boolean).length,totalConfigurationChecks:Object.keys(configured).length,remainingExternalChecks:nextChecks.filter(x=>!x.verified).length};
  return res.status(200).json({ok:true,readinessStatus,summary,configured,readOnlyConfigured,readOnlyMissing,readOnlyStatus,readOnlyNextChecks,flags,missing,readyForSandboxConfiguration:missing.length===0,liveIntegrationVerified:false,nextChecks,remediation:missing.map(id=>({id,instruction:remediation[id]})),note:'Configuration presence only. No external connectivity or real order validation was performed.'});
}
