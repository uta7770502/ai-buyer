import crypto from 'crypto';
const BASE='https://developers.cjdropshipping.com/api2.0/v1';
export const config={api:{bodyParser:false}};
let tokenCache={token:'',expiresAt:0};
async function readRaw(req){const chunks=[];let size=0;for await(const c of req){const chunk=Buffer.isBuffer(c)?c:Buffer.from(c);size+=chunk.length;if(size>1024*1024){const e=new Error('Webhook payload too large');e.statusCode=413;throw e;}chunks.push(chunk)}return Buffer.concat(chunks)}
function validHmac(raw,hmac,secret){if(typeof hmac!=='string'||!secret||!/^[A-Za-z0-9+/]{43}=$/.test(hmac))return false;const digest=crypto.createHmac('sha256',secret).update(raw).digest();const supplied=Buffer.from(hmac,'base64');return supplied.length===digest.length&&crypto.timingSafeEqual(digest,supplied)}
async function cjToken(){if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;if(tokenCache.token&&Date.now()<tokenCache.expiresAt-60000)return tokenCache.token;if(!process.env.CJ_API_KEY)throw Error('CJ_API_KEY is not configured');const r=await fetch(BASE+'/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:process.env.CJ_API_KEY})});const j=await r.json();if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error(j.message||'CJ authentication failed');tokenCache={token:j.data.accessToken,expiresAt:Date.now()+12*60*60*1000};return tokenCache.token}
function str(v,n=200){return String(v||'').trim().slice(0,n)}
// Persistent, atomic order reservation. Never expire automatically: uncertain CJ outcomes
// must be reconciled manually instead of allowing a duplicate purchase.
async function reserveOrder(shop,orderId){
  const url=process.env.UPSTASH_REDIS_REST_URL;
  const token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token)throw Error('Durable idempotency storage is not configured');
  const key='ai-buyer:cj-sandbox:'+crypto.createHash('sha256').update(shop+':'+orderId).digest('hex');
  const r=await fetch(url.replace(/\/$/,'')+'/',{
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},method:'POST',body:JSON.stringify(['SET',key,'reserved','NX'])
  });
  if(!r.ok)throw Error('Idempotency store unavailable');
  const j=await r.json();
  if(j.error)throw Error('Idempotency store rejected reservation');
  if(j.result!==null&&j.result!=='OK')throw Error('Unexpected idempotency reservation response');
  return j.result==='OK';
}
async function markOrder(shop,orderId,status){
  const url=process.env.UPSTASH_REDIS_REST_URL;
  const token=process.env.UPSTASH_REDIS_REST_TOKEN;
  const key='ai-buyer:cj-sandbox:'+crypto.createHash('sha256').update(shop+':'+orderId).digest('hex');
  const r=await fetch(url.replace(/\/$/,'')+'/',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(['SET',key,status])});
  if(!r.ok)throw Error('Failed to persist order state');const j=await r.json();if(j.error||j.result!=='OK')throw Error('Failed to persist order state');
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).end();
  try{
    const raw=await readRaw(req);
    const secret=String(process.env.SHOPIFY_CLIENT_SECRET||'');
    if(!validHmac(raw,req.headers['x-shopify-hmac-sha256'],secret))return res.status(401).json({ok:false,error:'Invalid Shopify webhook signature'});
    const order=JSON.parse(raw.toString('utf8')||'{}'),addr=order.shipping_address||{};
    // Fail closed: sandbox CJ order creation is opt-in until a durable idempotency store exists.
    if(process.env.CJ_SANDBOX_ORDER_ENABLED!=='true')return res.status(503).json({ok:false,error:'CJ sandbox order automation is disabled'});
    if(String(req.headers['x-shopify-topic']||'')!=='orders/paid')return res.status(200).json({ok:true,skipped:true,reason:'Only paid orders are eligible'});
    if(order.cancelled_at||order.financial_status!=='paid')return res.status(200).json({ok:true,skipped:true,reason:'Order not eligible for fulfillment'});
    if(!order.id||!req.headers['x-shopify-webhook-id'])return res.status(400).json({ok:false,error:'Missing order or event identifier'});
    // Without durable event deduplication, retrying this handler may duplicate CJ sandbox orders.
    // Keep this endpoint disabled for live fulfillment.
    // A valid HMAC proves app origin, not that the order belongs to the configured merchant.
    const allowedShop=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
    const webhookShop=String(req.headers['x-shopify-shop-domain']||'').trim().toLowerCase();
    if(!allowedShop||!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(allowedShop))
      return res.status(503).json({ok:false,error:'Allowed Shopify shop is not configured'});
    if(webhookShop!==allowedShop)return res.status(403).json({ok:false,error:'Shopify shop is not authorized'});
    const lines=(Array.isArray(order.line_items)?order.line_items:[]).filter(x=>x&&x.sku&&Number(x.quantity)>0);
    if(!lines.length||lines.length!==(Array.isArray(order.line_items)?order.line_items.length:0))return res.status(422).json({ok:false,error:'CJ variant mapping is incomplete; order requires review'});
    // Spending limits are mandatory even in sandbox mode. No live CJ payments here.
    const maxItems=Number(process.env.CJ_MAX_ITEMS_PER_ORDER);
    const maxOrderValue=Number(process.env.CJ_MAX_ORDER_VALUE);
    const orderValue=Number(order.current_total_price??order.total_price);
    const totalItems=lines.reduce((sum,x)=>sum+Number(x.quantity),0);
    if(!Number.isFinite(maxItems)||maxItems<=0||!Number.isFinite(maxOrderValue)||maxOrderValue<=0)
      return res.status(503).json({ok:false,error:'CJ order safety limits are not configured'});
    // Shopify order amounts are denominated in the order currency. Never compare
    // unconverted amounts against a limit configured for a different currency.
    const allowedCurrency=String(process.env.CJ_ORDER_LIMIT_CURRENCY||'').toUpperCase();
    const orderCurrency=String(order.currency||'').toUpperCase();
    if(!/^[A-Z]{3}$/.test(allowedCurrency)||orderCurrency!==allowedCurrency)
      return res.status(422).json({ok:false,error:'Order currency does not match configured spending-limit currency'});
    if(order.test!==true&&process.env.CJ_ALLOW_REAL_SHOPIFY_ORDERS_IN_SANDBOX!=='true')
      return res.status(422).json({ok:false,error:'Only Shopify test orders are accepted by default'});
    if(!Number.isFinite(orderValue)||orderValue<0||!Number.isSafeInteger(totalItems)||totalItems>maxItems||orderValue>maxOrderValue)
      return res.status(422).json({ok:false,error:'Order exceeds safety limits or has invalid totals'});
    const countryCode=str(addr.country_code,2).toUpperCase();
    if(!countryCode||!addr.city||!addr.address1||!addr.name)return res.status(422).json({ok:false,error:'Shipping address incomplete; order requires review'});
    // Require explicit CJ variant identifiers; a merchant SKU is not a CJ VID.
    if(lines.some(x=>!/^[A-Za-z0-9_-]{6,100}$/.test(String(x.sku||''))))
      return res.status(422).json({ok:false,error:'CJ variant identifiers must be validated before ordering'});
    if(lines.length>20||lines.some(x=>!Number.isSafeInteger(Number(x.quantity))||Number(x.quantity)>50))return res.status(422).json({ok:false,error:'Unsupported order size; manual review required'});
    const access=await cjToken(),headers={'CJ-Access-Token':access,'Content-Type':'application/json'};
    const products=lines.map(x=>({vid:str(x.sku,100),quantity:Math.max(1,Math.min(50,Number(x.quantity)||1)),storeLineItemId:str(x.id,125)}));
    const freight=await fetch(BASE+'/logistic/freightCalculate',{method:'POST',headers,body:JSON.stringify({startCountryCode:'CN',endCountryCode:countryCode,products:products.map(x=>({quantity:x.quantity,vid:x.vid}))})});
    const fq=await freight.json();
    if(!freight.ok||fq.result!==true)throw Error(fq.message||'CJ freight quote failed');
    const opts=(Array.isArray(fq.data)?fq.data:[]).map(x=>({name:str(x.logisticName,50),usd:Number(x.totalPostageFee??x.logisticPrice),days:str(x.logisticAging,50)})).filter(x=>x.name&&Number.isFinite(x.usd)&&x.usd>=0).sort((a,b)=>a.usd-b.usd);
    if(!opts.length)throw Error('CJ配送方法が見つかりません');
    const chosen=opts[0];
    const body={
      orderNumber:'SHOP-'+str(order.id,40),
      shippingZip:str(addr.zip,20),
      shippingCountry:str(addr.country,50)||countryCode,
      shippingCountryCode:countryCode,
      shippingProvince:str(addr.province,50)||'-',
      shippingCity:str(addr.city,50),
      shippingPhone:str(addr.phone||order.phone,20),
      shippingCustomerName:str(addr.name,50),
      shippingAddress:str(addr.address1,200),
      shippingAddress2:str(addr.address2,200),
      email:str(order.email,50),
      remark:'AI BUYER Shopify order '+str(order.name,50),
      payType:3,
      isSandbox:1,
      logisticName:chosen.name,
      fromCountryCode:'CN',
      platform:'shopify',
      orderFlow:1,
      products
    };
    const shop=str(req.headers['x-shopify-shop-domain'],255).toLowerCase();
    if(!/^[a-z0-9][a-z0-9.-]*\.myshopify\.com$/.test(shop))return res.status(400).json({ok:false,error:'Invalid Shopify shop domain'});
    const reserved=await reserveOrder(shop,String(order.id));
    if(!reserved)return res.status(200).json({ok:true,skipped:true,reason:'Order already reserved or processed'});
    // A timeout or network error may mean CJ accepted the order. Never auto-retry
    // after reservation; record an ambiguous state for human reconciliation.
    let cr,cj;
    try{
      cr=await fetch(BASE+'/shopping/order/createOrderV2',{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      cj=await cr.json();
    }catch{
      await markOrder(shop,String(order.id),'needs_review:unknown_cj_result');
      return res.status(202).json({ok:false,needsReview:true,error:'CJ result uncertain; do not retry automatically'});
    }
    if(!cr.ok||cj.result!==true){
      await markOrder(shop,String(order.id),'needs_review:cj_rejected');
      return res.status(202).json({ok:false,needsReview:true,error:'CJ rejected sandbox order; manual reconciliation required'});
    }
    const confirmedCjId=str(cj.data?.orderId||cj.data?.orderNumber,100);
    if(!confirmedCjId){
      await markOrder(shop,String(order.id),'needs_review:missing_cj_order_id');
      return res.status(202).json({ok:false,needsReview:true,error:'CJ acknowledged order without an identifier; manual reconciliation required'});
    }
    await markOrder(shop,String(order.id),'created:'+confirmedCjId);
    return res.status(200).json({ok:true,sandbox:true,cjOrderId:cj.data?.orderId||'',cjOrderNumber:cj.data?.orderNumber||'',logisticName:chosen.name});
  }catch(e){return res.status(e.statusCode===413?413:500).json({ok:false,error:e.statusCode===413?'Webhook payload too large':'CJ order processing failed'})}
}