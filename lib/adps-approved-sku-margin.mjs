import {evaluateMarginTiers} from './adps-net-margin.mjs';

// Server-side approval is scoped to a single CJ SKU. Never trust approval
// metadata from a browser request or accept a general account-wide waiver.
export function evaluateApprovedSkuMargin(costs, evidence, approval, sku) {
  const result=evaluateMarginTiers(costs,evidence);
  if(!result.eligible || result.tier===0.30) return result;
  const validSku=typeof sku==='string' && sku.trim().length>0;
  const approved=approval && approval.source==='server' &&
    approval.approved===true && approval.sku===sku &&
    (approval.minimumMargin===0.25 || approval.minimumMargin===0.20);
  if(!validSku || !approved || result.margin+1e-12<approval.minimumMargin) {
    return {...result,eligible:false,tier:null,reason:'sku-margin-exception-not-approved'};
  }
  return {...result,tier:approval.minimumMargin,reason:null};
}
