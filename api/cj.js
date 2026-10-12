import cjDetail from '../lib/routes/cj-detail.js';
import cjFreight from '../lib/routes/cj-freight.js';
import cjMonitor from '../lib/routes/cj-monitor.js';
import cjRisk from '../lib/routes/cj-risk.js';
import cjSearch from '../lib/routes/cj-search.js';
import cjOrderTracking from '../lib/routes/cj-order-tracking.js';
import cjTrackingSync from '../lib/routes/cj-tracking-sync.js';
import cjReadiness from '../lib/routes/cj-readiness.js';

import cjSandboxSimulate from '../lib/routes/cj-sandbox-simulate.js';
import cjSandboxReconcile from '../lib/routes/cj-sandbox-reconcile.js';

const handlers={
  'sandbox-simulate':cjSandboxSimulate,
  'sandbox-reconcile':cjSandboxReconcile,
  'detail':cjDetail,
  'freight':cjFreight,
  'monitor':cjMonitor,
  'risk':cjRisk,
  'search':cjSearch,
  'order-tracking':cjOrderTracking,
  'tracking-sync':cjTrackingSync,
  'readiness':cjReadiness
};
export default async function handler(req,res){
  const action=String(req.query.action||'');
  const selected=Object.hasOwn(handlers,action)?handlers[action]:null;
  if(!selected)return res.status(404).json({ok:false,error:'Unknown CJ route'});
  return selected(req,res);
}
