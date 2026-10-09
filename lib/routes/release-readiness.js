export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=process.env.AI_BUYER_ADMIN_KEY;
  if(!admin||req.headers.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});

  const checks={
    shopifyClientSecret:Boolean(process.env.SHOPIFY_CLIENT_SECRET),
    shopifyAllowedShop:/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase()),
    cjCredentials:Boolean(process.env.CJ_ACCESS_TOKEN||process.env.CJ_API_KEY),
    redisConfigured:Boolean(process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN),
    cjSandboxEnabled:process.env.CJ_SANDBOX_ORDER_ENABLED==='true',
    fulfillmentSyncEnabled:process.env.SHOPIFY_FULFILLMENT_SYNC_ENABLED==='true',
    maxItems:Number.isFinite(Number(process.env.CJ_MAX_ITEMS_PER_ORDER))&&Number(process.env.CJ_MAX_ITEMS_PER_ORDER)>0,
    maxOrderValue:Number.isFinite(Number(process.env.CJ_MAX_ORDER_VALUE))&&Number(process.env.CJ_MAX_ORDER_VALUE)>0,
    maxFreightUsd:Number.isFinite(Number(process.env.CJ_MAX_FREIGHT_USD))&&Number(process.env.CJ_MAX_FREIGHT_USD)>0,
    limitCurrency:/^[A-Z]{3}$/.test(String(process.env.CJ_ORDER_LIMIT_CURRENCY||'').toUpperCase())
  };

  let redisReachable=false;
  if(checks.redisConfigured){
    try{
      const base=process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/,'');
      const r=await fetch(base+'/ping',{headers:{Authorization:'Bearer '+process.env.UPSTASH_REDIS_REST_TOKEN},signal:AbortSignal.timeout(4000)});
      const j=await r.json();
      redisReachable=r.ok&&j.result==='PONG';
    }catch{}
  }

  const sandboxOrderReady=
    checks.shopifyClientSecret&&
    checks.shopifyAllowedShop&&
    checks.cjCredentials&&
    checks.redisConfigured&&
    redisReachable&&
    checks.cjSandboxEnabled&&
    checks.maxItems&&
    checks.maxOrderValue&&
    checks.maxFreightUsd&&
    checks.limitCurrency;

  const blockers=[];
  if(!checks.shopifyClientSecret)blockers.push('SHOPIFY_CLIENT_SECRET');
  if(!checks.shopifyAllowedShop)blockers.push('SHOPIFY_ALLOWED_SHOP_DOMAIN');
  if(!checks.cjCredentials)blockers.push('CJ credentials');
  if(!checks.redisConfigured||!redisReachable)blockers.push('Redis');
  if(!checks.maxItems)blockers.push('CJ_MAX_ITEMS_PER_ORDER');
  if(!checks.maxOrderValue)blockers.push('CJ_MAX_ORDER_VALUE');
  if(!checks.maxFreightUsd)blockers.push('CJ_MAX_FREIGHT_USD');
  if(!checks.limitCurrency)blockers.push('CJ_ORDER_LIMIT_CURRENCY');

  return res.status(200).json({
    ok:true,
    checks,
    redisReachable,
    sandboxOrderReady,
    fulfillmentSyncOptIn:checks.fulfillmentSyncEnabled,
    liveCjOrdersEnabled:false,
    readyForLive:false,
    blockers
  });
}
