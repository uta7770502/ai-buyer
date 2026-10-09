// Read-only configuration diagnostics. Never expose credentials or customer data.
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  res.setHeader('Cache-Control','no-store');
  const key=process.env.AI_BUYER_ADMIN_KEY;
  if(!key||req.headers.authorization!=='Bearer '+key)return res.status(401).json({ok:false,error:'Unauthorized'});
  const checks={
    shopifyWebhookSecret:Boolean(process.env.SHOPIFY_CLIENT_SECRET),
    allowedShopConfigured:/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase()),
    cjCredentials:Boolean(process.env.CJ_ACCESS_TOKEN||process.env.CJ_API_KEY),
    durableOrderStore:Boolean(process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN),
    sandboxOptIn:process.env.CJ_SANDBOX_ORDER_ENABLED==='true',
    maxItemsPerOrderConfigured:Number.isFinite(Number(process.env.CJ_MAX_ITEMS_PER_ORDER))&&Number(process.env.CJ_MAX_ITEMS_PER_ORDER)>0,
    maxOrderValueConfigured:Number.isFinite(Number(process.env.CJ_MAX_ORDER_VALUE))&&Number(process.env.CJ_MAX_ORDER_VALUE)>0,
    maxFreightUsdConfigured:Number.isFinite(Number(process.env.CJ_MAX_FREIGHT_USD))&&Number(process.env.CJ_MAX_FREIGHT_USD)>0,
    limitCurrencyConfigured:/^[A-Z]{3}$/.test(String(process.env.CJ_ORDER_LIMIT_CURRENCY||'').toUpperCase())
  };
  let redisReachable=false;
  if(checks.durableOrderStore){
    try{
      const base=process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/,'');
      const r=await fetch(base+'/ping',{headers:{Authorization:'Bearer '+process.env.UPSTASH_REDIS_REST_TOKEN},signal:AbortSignal.timeout(4000)});
      const j=await r.json();
      redisReachable=r.ok&&j.result==='PONG';
    }catch{}
  }
  const sandboxReady=checks.shopifyWebhookSecret&&checks.allowedShopConfigured&&checks.cjCredentials&&checks.durableOrderStore&&redisReachable&&checks.sandboxOptIn&&checks.maxItemsPerOrderConfigured&&checks.maxOrderValueConfigured&&checks.maxFreightUsdConfigured&&checks.limitCurrencyConfigured;
  return res.status(200).json({ok:true,checks,redisReachable,sandboxReady,liveOrdersEnabled:false,note:'Live fulfillment and payment are not implemented'});
}
