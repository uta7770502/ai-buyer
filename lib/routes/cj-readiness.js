import crypto from 'node:crypto';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
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
    orderLimits:Number.isSafeInteger(Number(process.env.CJ_MAX_ITEMS_PER_ORDER))&&Number(process.env.CJ_MAX_ITEMS_PER_ORDER)>0&&Number.isFinite(Number(process.env.CJ_MAX_ORDER_VALUE))&&Number(process.env.CJ_MAX_ORDER_VALUE)>0&&/^[A-Z]{3}$/.test(String(process.env.CJ_ORDER_LIMIT_CURRENCY||'')),
    freightLimit:Number.isFinite(Number(process.env.CJ_MAX_FREIGHT_USD))&&Number(process.env.CJ_MAX_FREIGHT_USD)>0,
    destinationCountry:/^[A-Z]{2}$/.test(String(process.env.CJ_ALLOWED_DESTINATION_COUNTRY||'JP')),
  };
  const flags={
    sandboxOrderEnabled:process.env.CJ_SANDBOX_ORDER_ENABLED==='true',
    sandboxTrackingSyncEnabled:process.env.CJ_SANDBOX_TRACKING_SYNC_ENABLED==='true'
  };
  const missing=Object.entries(configured).filter(([,ok])=>!ok).map(([name])=>name);
  return res.status(200).json({ok:true,configured,flags,missing,readyForSandboxConfiguration:missing.length===0,liveIntegrationVerified:false,note:'Configuration presence only. No external connectivity or real order validation was performed.'});
}
