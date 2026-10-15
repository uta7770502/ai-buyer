import { getShopifyAuthContext } from '../shopify-auth-context.js';
import crypto from 'node:crypto';
const VERSION='2026-10';
const BASE='https://developers.cjdropshipping.com/api2.0/v1';
let tokenCache={token:'',expiresAt:0};

function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(10000)});
  const j=await r.json();if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify API request failed');return j.data;
}
async function cjToken(){
  if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
  if(tokenCache.token&&Date.now()<tokenCache.expiresAt-60000)return tokenCache.token;
  const r=await fetch(BASE+'/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:process.env.CJ_API_KEY}),signal:AbortSignal.timeout(8000)});
  const j=await r.json();if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error('CJ authentication failed');
  tokenCache={token:j.data.accessToken,expiresAt:Date.now()+12*3600000};return tokenCache.token;
}
async function redis(command){
  const url=process.env.UPSTASH_REDIS_REST_URL,token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token)throw Error('Order database is not configured');
  const r=await fetch(url.replace(/\/$/,'')+'/',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(5000)});
  const j=await r.json();if(!r.ok||j.error||!Object.hasOwn(j,'result'))throw Error('Order database unavailable');return j.result;
}
function orderKey(shop,id){return 'ai-buyer:cj-sandbox:'+crypto.createHash('sha256').update(shop+':'+id).digest('hex')}
function str(v,n=200){return String(v||'').trim().slice(0,n)}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
  if(!admin||req.headers.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  if(process.env.CJ_SANDBOX_ORDER_ENABLED!=='true')return res.status(503).json({ok:false,error:'CJ sandbox order automation is disabled'});
  try{
    const auth=await getShopifyAuthContext(req);
    if(!auth.ok)return res.status(auth.status).json({ok:false,authRequired:Boolean(auth.authRequired),error:auth.error});
    const {token,shop}=auth;
    const orderId=String(req.body?.orderId||'').trim();
    if(!/^\d{1,30}$/.test(orderId))return res.status(400).json({ok:false,error:'Shopify orderId is invalid'});
    const data=await gql(shop,token,`query($id:ID!){order(id:$id){id name test displayFinancialStatus currencyCode currentTotalPriceSet{shopMoney{amount currencyCode}} email phone shippingAddress{name address1 address2 city province zip country countryCodeV2 phone} lineItems(first:20){nodes{id sku quantity}}}}`,{id:'gid://shopify/Order/'+orderId});
    const order=data?.order;if(!order)return res.status(404).json({ok:false,error:'Shopify注文が見つかりません'});
    if(order.displayFinancialStatus!=='PAID')return res.status(422).json({ok:false,error:'支払い済み注文のみサンドボックス検証できます'});
    const addr=order.shippingAddress||{},lines=order.lineItems?.nodes||[];
    if(!addr.name||!addr.address1||!addr.city||!addr.countryCodeV2)return res.status(422).json({ok:false,error:'配送先住所が不足しています'});
    if(!lines.length||lines.some(x=>!x.sku||!/^[A-Za-z0-9_-]{6,100}$/.test(String(x.sku))))return res.status(422).json({ok:false,error:'CJ商品バリエーションID(SKU)が未設定です。商品同期を確認してください'});
    const maxItems=Number(process.env.CJ_MAX_ITEMS_PER_ORDER),maxOrderValue=Number(process.env.CJ_MAX_ORDER_VALUE),maxFreightUsd=Number(process.env.CJ_MAX_FREIGHT_USD);
    const totalItems=lines.reduce((n,x)=>n+Number(x.quantity||0),0),orderValue=Number(order.currentTotalPriceSet?.shopMoney?.amount);
    const limitCurrency=String(process.env.CJ_ORDER_LIMIT_CURRENCY||'').toUpperCase();
    if(order.currencyCode!==limitCurrency||!Number.isFinite(orderValue)||orderValue>maxOrderValue||totalItems>maxItems)return res.status(422).json({ok:false,error:'注文が安全上限または通貨条件を満たしていません'});
    const key=orderKey(shop,orderId),existing=await redis(['GET',key]);
    if(typeof existing==='string'&&existing.startsWith('created:'))return res.status(200).json({ok:true,sandbox:true,existing:true,cjOrderId:existing.slice(8)});
    if(existing&&existing!=='reserved')return res.status(409).json({ok:false,needsReview:true,error:'既存の未確定処理があります。自動再実行しません'});
    if(!existing){const set=await redis(['SET',key,'reserved','NX']);if(set!=='OK')return res.status(409).json({ok:false,error:'注文を予約できませんでした'})}
    const access=await cjToken(),headers={'CJ-Access-Token':access,'Content-Type':'application/json'};
    const products=lines.map(x=>({vid:str(x.sku,100),quantity:Number(x.quantity),storeLineItemId:str(String(x.id).split('/').pop(),125)}));
    const freight=await fetch(BASE+'/logistic/freightCalculate',{method:'POST',headers,body:JSON.stringify({startCountryCode:'CN',endCountryCode:String(addr.countryCodeV2),products:products.map(x=>({quantity:x.quantity,vid:x.vid}))}),signal:AbortSignal.timeout(10000)});
    const fq=await freight.json();if(!freight.ok||fq.result!==true)throw Error(fq.message||'CJ freight quote failed');
    const opts=(Array.isArray(fq.data)?fq.data:[]).map(x=>({name:str(x.logisticName,50),usd:Number(x.totalPostageFee??x.logisticPrice),days:str(x.logisticAging,50)})).filter(x=>x.name&&Number.isFinite(x.usd)&&x.usd>=0).sort((a,b)=>a.usd-b.usd);
    if(!opts.length||!Number.isFinite(maxFreightUsd)||opts[0].usd>maxFreightUsd)return res.status(422).json({ok:false,error:'CJ配送条件が安全上限を満たしていません'});
    const chosen=opts[0];
    const body={orderNumber:'SHOP-'+orderId,shippingZip:str(addr.zip,20),shippingCountry:str(addr.country,50)||String(addr.countryCodeV2),shippingCountryCode:String(addr.countryCodeV2),shippingProvince:str(addr.province,50)||'-',shippingCity:str(addr.city,50),shippingPhone:str(addr.phone||order.phone,20),shippingCustomerName:str(addr.name,50),shippingAddress:str(addr.address1,200),shippingAddress2:str(addr.address2,200),email:str(order.email,50),remark:'AI BUYER manual sandbox validation '+str(order.name,50),payType:3,isSandbox:1,logisticName:chosen.name,fromCountryCode:'CN',platform:'shopify',orderFlow:1,products};
    let cr,cj;
    try{cr=await fetch(BASE+'/shopping/order/createOrderV2',{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});cj=await cr.json()}catch{await redis(['SET',key,'needs_review:unknown_cj_result']);return res.status(202).json({ok:false,needsReview:true,error:'CJ結果が未確定です。自動再実行しません'})}
    if(!cr.ok||cj.result!==true){await redis(['SET',key,'needs_review:cj_rejected']);return res.status(202).json({ok:false,needsReview:true,error:cj.message||'CJサンドボックス注文が拒否されました'})}
    const cjId=str(cj.data?.orderId||cj.data?.orderNumber,100);if(!cjId){await redis(['SET',key,'needs_review:missing_cj_order_id']);return res.status(202).json({ok:false,needsReview:true,error:'CJ注文IDを確認できません'})}
    await redis(['SET',key,'created:'+cjId]);
    return res.status(200).json({ok:true,sandbox:true,cjOrderId:cjId,logisticName:chosen.name,manualSandboxValidation:true});
  }catch(e){return res.status(500).json({ok:false,error:e.message||'サンドボックス注文検証に失敗しました'})}
}
