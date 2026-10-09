import cjDetail from '../lib/routes/cj-detail.js';
import cjFreight from '../lib/routes/cj-freight.js';
import cjMonitor from '../lib/routes/cj-monitor.js';
import cjRisk from '../lib/routes/cj-risk.js';
import cjSearch from '../lib/routes/cj-search.js';

const handlers={
  'detail':cjDetail,
  'freight':cjFreight,
  'monitor':cjMonitor,
  'risk':cjRisk,
  'search':cjSearch
};
export default async function handler(req,res){
  const action=String(req.query.action||'');
  const selected=handlers[action];
  if(!selected)return res.status(404).json({ok:false,error:'Unknown CJ route'});
  return selected(req,res);
}
