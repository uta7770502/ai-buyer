import {evaluateMarginTiers} from './adps-net-margin.mjs';

// Only server-issued, SKU-specific approval can lower the default 25% gate.
// This helper does not itself authorize publishing or verify external evidence.
function isCanonicalSku(sku) {
  if(typeof sku!=='string' || sku.length===0 || sku.length>160 || sku!==sku.trim()) return false;
  for(const character of sku) {
    const code=character.codePointAt(0);
    if(code<=31 || code===127 || /[\p{Cf}\p{Zl}\p{Zp}\p{Zs}]/u.test(character)) return false;
  }
  return true;
}

export function evaluateApprovedSkuMargin(costs, evidence, approval, sku) {
  const result=evaluateMarginTiers(costs,evidence);
  if(!result.eligible || result.tier===0.25) return result;
  const approved=approval && approval.source==='server' &&
    approval.approved===true && approval.sku===sku &&
    approval.minimumMargin===0.20;
  if(!isCanonicalSku(sku) || !approved || result.margin+1e-12<approval.minimumMargin) {
    return {...result,eligible:false,tier:null,reason:'sku-margin-exception-not-approved'};
  }
  return {...result,tier:approval.minimumMargin,reason:null};
}
