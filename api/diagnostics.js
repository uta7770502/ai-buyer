import automationHealth from '../lib/routes/automation-health.js';
import automationOrderStatus from '../lib/routes/automation-order-status.js';
import automationReconciliation from '../lib/routes/automation-reconciliation.js';
import cjHealth from '../lib/routes/cj-health.js';
import shopifyFulfillmentSync from '../lib/routes/shopify-fulfillment-sync.js';
import releaseReadiness from '../lib/routes/release-readiness.js';

const handlers={
  'automation-health':automationHealth,
  'automation-order-status':automationOrderStatus,
  'automation-reconciliation':automationReconciliation,
  'cj-health':cjHealth,
  'shopify-fulfillment-sync':shopifyFulfillmentSync,
  'release-readiness':releaseReadiness
};
export default async function handler(req,res){
  const action=String(req.query.action||'');
  const selected=handlers[action];
  if(!selected)return res.status(404).json({ok:false,error:'Unknown diagnostic route'});
  return selected(req,res);
}
