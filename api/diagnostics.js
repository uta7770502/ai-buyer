import automationHealth from '../lib/routes/automation-health.js';
import automationOrderStatus from '../lib/routes/automation-order-status.js';
import automationReconciliation from '../lib/routes/automation-reconciliation.js';
import cjHealth from '../lib/routes/cj-health.js';

const handlers={
  'automation-health':automationHealth,
  'automation-order-status':automationOrderStatus,
  'automation-reconciliation':automationReconciliation,
  'cj-health':cjHealth
};
export default async function handler(req,res){
  const action=String(req.query.action||'');
  const selected=handlers[action];
  if(!selected)return res.status(404).json({ok:false,error:'Unknown diagnostic route'});
  return selected(req,res);
}
