import automationHealth from '../lib/routes/automation-health.js';
import automationOrderStatus from '../lib/routes/automation-order-status.js';
import automationReconciliation from '../lib/routes/automation-reconciliation.js';
import cjHealth from '../lib/routes/cj-health.js';
import cjFreight from '../lib/routes/cj-freight.js';
import cjShopifyStockSync from '../lib/routes/cj-shopify-stock-sync.js';
import { validateCJStockResponse } from '../lib/cj-stock-validation.js';
import shopifyFulfillmentSync from '../lib/routes/shopify-fulfillment-sync.js';
import releaseReadiness from '../lib/routes/release-readiness.js';
import shopifySandboxOrder from '../lib/routes/shopify-sandbox-order.js';
import storefrontCheckout from '../lib/routes/storefront-checkout.js';
import storefrontConfig from '../lib/routes/storefront-config.js';
import prelaunchProductAudit from '../lib/routes/prelaunch-product-audit.js';
import prelaunchOneAction from '../lib/routes/prelaunch-one-action.js';

function normalizeShopHost(v){return String(v||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'')}
function shopifyEnvCheck(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const rawShop=normalizeShopHost(process.env.SHOPIFY_SHOP);
  const rawAllowed=normalizeShopHost(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN);
  const shop=rawShop.replace(/\.myshopify\.com$/i,'');
  const expected=shop?shop+'.myshopify.com':'';
  const validShop=/^[a-z0-9][a-z0-9-]*$/.test(shop);
  const validAllowed=/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(rawAllowed);
  return res.status(200).json({ok:true,shopConfigured:Boolean(rawShop),allowedConfigured:Boolean(rawAllowed),normalizedShop:shop,expectedAllowedDomain:expected,normalizedAllowedDomain:rawAllowed,validShop,validAllowed,matches:Boolean(validShop&&validAllowed&&expected===rawAllowed)});
}

async function previewPrelaunchSummary(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const allowed=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='safety-gate-20261024';
  if(!allowed)return res.status(404).json({ok:false});
  const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
  if(!admin)return res.status(503).json({ok:false,error:'Preview admin key missing'});
  const capture={code:200,status(n){this.code=n;return this},setHeader(){return this},json(v){this.body=v;return this},send(v){this.body=v;return this},end(){return this}};
  await prelaunchOneAction({method:'POST',headers:{authorization:'Bearer '+admin},query:{},body:{}},capture);
  const b=capture.body||{};
  return res.status(capture.code===200?200:503).json({
    ok:capture.code===200&&b.ok===true,
    readyToFinalManualStep:Boolean(b.readyToFinalManualStep),
    checkedAt:b.checkedAt||new Date().toISOString(),
    checks:b.checks||{},
    blockers:Array.isArray(b.blockers)?b.blockers.slice(0,20):[],
    warnings:Array.isArray(b.warnings)?b.warnings.slice(0,20):[],
    productAudit:{
      draftCount:Number(b.productAudit?.draftCount||0),
      readyDrafts:Number(b.productAudit?.readyDrafts||0),
      blockedDrafts:Number(b.productAudit?.blockedDrafts||0)
    },
    reconciliation:b.reconciliation?{total:Number(b.reconciliation.total||0),partial:Boolean(b.reconciliation.partial)}:null
  });
}

async function previewCjDraftAudit(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const allowed=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='safety-gate-20261024';
  if(!allowed)return res.status(404).json({ok:false});
  const vids=[
    '1421057421656330240','1657322876615274496','1641339380621119488',
    '1637037130838978560','1380443011925807104','1443515898471256064',
    '2408310600381614000','1416372414316679168','1763801727867822080'
  ];
  const rows=[];
  for(const vid of vids){
    const cap={code:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(v){this.body=v;return this},send(v){this.body=v;return this},end(){return this}};
    await cjFreight({method:'GET',headers:{},query:{vid,destination:'JP'}},cap);
    const b=cap.body||{};
    rows.push({
      vid,
      ok:cap.code===200&&b.ok===true,
      shippingJpy:Number.isFinite(Number(b.shippingCostJpy))?Number(b.shippingCostJpy):null,
      shippingVerified:b.shippingJpyVerified===true,
      optionCount:Array.isArray(b.options)?b.options.length:0,
      error:cap.code===200&&b.ok===true?null:String(b.code||b.error||'CJ lookup failed').slice(0,120)
    });
  }
  return res.status(200).json({
    ok:true,readOnly:true,checkedAt:new Date().toISOString(),
    total:rows.length,passed:rows.filter(x=>x.ok).length,failed:rows.filter(x=>!x.ok).length,
    rows
  });
}

async function previewCjStockAudit(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const allowed=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='safety-gate-20261024';
  if(!allowed)return res.status(404).json({ok:false});
  const vids=[
    '1421057421656330240','1657322876615274496','1641339380621119488',
    '1637037130838978560','1380443011925807104','1443515898471256064',
    '2408310600381614000','1416372414316679168','1763801727867822080'
  ];
  const BASE='https://developers.cjdropshipping.com/api2.0/v1';
  async function token(){
    if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
    const rr=await fetch(BASE+'/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:process.env.CJ_API_KEY}),signal:AbortSignal.timeout(10000)});
    const jj=await rr.json();if(!rr.ok||jj.result!==true||!jj.data?.accessToken)throw Error('CJ auth failed');return jj.data.accessToken;
  }
  try{
    const t=await token(),rows=[];
    for(const vid of vids){
      const u=new URL(BASE+'/product/stock/queryByVid');u.searchParams.set('vid',vid);
      const rr=await fetch(u,{headers:{'CJ-Access-Token':t},signal:AbortSignal.timeout(10000)});
      const jj=await rr.json().catch(()=>({}));
      const valid=rr.ok?validateCJStockResponse(jj):{ok:false,reason:'cj-http-error'};
      const verified=Array.isArray(jj.data)?jj.data.filter(x=>x&&Number(x.verifiedWarehouse)===1):[];
      const total=valid.ok?valid.total:null;
      const available=valid.ok&&total>0;
      const dataShape=Array.isArray(jj.data)?'array':jj.data===null?'null':typeof jj.data;
      const warehouseFlagValues=Array.isArray(jj.data)
        ?[...new Set(jj.data.map(x=>x?.verifiedWarehouse===undefined?'missing':String(x.verifiedWarehouse)))].slice(0,5)
        :[];
      rows.push({
        vid,ok:valid.ok,reason:valid.ok?null:valid.reason,
        status:!valid.ok?'unverified':available?'available':'out-of-stock',
        verifiedWarehouseCount:verified.length,totalInventory:total,
        diagnostic:valid.ok?null:{
          httpStatus:rr.status,
          cjResult:jj.result===true?'true':jj.result===false?'false':'missing',
          cjCode:typeof jj.code==='number'||typeof jj.code==='string'?String(jj.code).slice(0,32):null,
          dataShape,warehouseRows:Array.isArray(jj.data)?jj.data.length:null,
          warehouseFlagValues
        },
        available
      });
      await new Promise(r=>setTimeout(r,650));
    }
    return res.status(200).json({ok:true,readOnly:true,total:rows.length,available:rows.filter(x=>x.status==='available').length,unavailable:rows.filter(x=>x.status==='out-of-stock').length,unverified:rows.filter(x=>x.status==='unverified').length,allVerified:rows.every(x=>x.ok),rows});
  }catch(e){return res.status(503).json({ok:false,error:'CJ stock audit failed'})}
}

function deploymentInfo(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const sha=String(process.env.VERCEL_GIT_COMMIT_SHA||'');
  return res.status(200).json({ok:true,deployedAt:null,commitSha:/^[a-f0-9]{40}$/.test(sha)?sha.slice(0,7):null,deploymentTimeAvailable:false});
}
const handlers={
  'deployment-info':deploymentInfo,
  'preview-prelaunch-summary':previewPrelaunchSummary,
  'preview-cj-draft-audit':previewCjDraftAudit,
  'preview-cj-stock-audit':previewCjStockAudit,
  'cj-shopify-stock-sync':cjShopifyStockSync,
  'automation-health':automationHealth,
  'automation-order-status':automationOrderStatus,
  'automation-reconciliation':automationReconciliation,
  'cj-health':cjHealth,
  'shopify-fulfillment-sync':shopifyFulfillmentSync,
  'release-readiness':releaseReadiness,
  'shopify-sandbox-order':shopifySandboxOrder,
  'shopify-env-check':shopifyEnvCheck,
  'storefront-checkout':storefrontCheckout,
  'storefront-config':storefrontConfig,
  'prelaunch-product-audit':prelaunchProductAudit,
  'prelaunch-one-action':prelaunchOneAction
};
export default async function handler(req,res){
  const action=String(req.query.action||'');
  const selected=Object.hasOwn(handlers,action)?handlers[action]:null;
  if(!selected)return res.status(404).json({ok:false,error:'Unknown diagnostic route'});
  return selected(req,res);
}
