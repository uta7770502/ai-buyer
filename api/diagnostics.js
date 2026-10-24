import automationHealth from '../lib/routes/automation-health.js';
import automationOrderStatus from '../lib/routes/automation-order-status.js';
import automationReconciliation from '../lib/routes/automation-reconciliation.js';
import cjHealth from '../lib/routes/cj-health.js';
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

function deploymentInfo(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const sha=String(process.env.VERCEL_GIT_COMMIT_SHA||'');
  return res.status(200).json({ok:true,deployedAt:null,commitSha:/^[a-f0-9]{40}$/.test(sha)?sha.slice(0,7):null,deploymentTimeAvailable:false});
}
const handlers={
  'deployment-info':deploymentInfo,
  'preview-prelaunch-summary':previewPrelaunchSummary,
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
