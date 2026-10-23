import legalDraft from '../lib/routes/legal-draft.js';
import returnTriage from '../lib/routes/return-triage.js';
import profitEstimate from '../lib/routes/profit-estimate.js';
import shopifyLegalPreview from '../lib/routes/shopify-legal-preview.js';
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

function dsersGateway(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const action=String(req.query?.dsersAction||'health');
  if(action==='health')return res.status(200).json({ok:true,provider:'dsers',transport:'mcp',auth:'oauth2.1-pkce',connected:false,status:'authorization_required',endpoint:'https://ai.dsers.com/mcp',message:'DSers MCP OAuth connection is not yet configured for AI BUYER.'});
  if(action==='search')return res.status(428).json({ok:false,provider:'dsers',code:'DSERS_AUTH_REQUIRED',status:'authorization_required',products:[],message:'Authorize AI BUYER with DSers OAuth before supplier search can run.'});
  return res.status(400).json({ok:false,error:'unsupported_action'});
}

const handlers={
  'legal-draft':legalDraft,
  'return-triage':returnTriage,
  'profit-estimate':profitEstimate,
  'shopify-legal-preview':shopifyLegalPreview,
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
  'prelaunch-one-action':prelaunchOneAction,
  'dsers':dsersGateway
};
export default async function handler(req,res){
  const action=String(req.query.action||'');
  const selected=Object.hasOwn(handlers,action)?handlers[action]:null;
  if(!selected)return res.status(404).json({ok:false,error:'Unknown diagnostic route'});
  return selected(req,res);
}
