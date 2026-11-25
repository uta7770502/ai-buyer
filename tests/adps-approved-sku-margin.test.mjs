import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateApprovedSkuMargin} from '../lib/adps-approved-sku-margin.mjs';
const evidence={feeEvidenceVerified:true,shippingEvidenceVerified:true};
const base={priceYen:2000,costYen:1150,shippingYen:200,percentageFee:0.035};
test('25 percent and above need no exception',()=>{
 for(const costYen of [1000,1150,1230]) assert.equal(evaluateApprovedSkuMargin({...base,costYen},evidence,null,'SKU-A').eligible,true);
});
test('20 percent requires matching server approval',()=>{
 const costs={...base,costYen:1250};
 for(const approval of [null,{approved:true,sku:'SKU-A',minimumMargin:0.20},{source:'server',approved:true,sku:'SKU-B',minimumMargin:0.20},{source:'server',approved:'true',sku:'SKU-A',minimumMargin:0.20},{source:'server',approved:true,sku:'SKU-A',minimumMargin:0.25}]) {
  assert.equal(evaluateApprovedSkuMargin(costs,evidence,approval,'SKU-A').eligible,false);
 }
 assert.equal(evaluateApprovedSkuMargin(costs,evidence,{source:'server',approved:true,sku:'SKU-A',minimumMargin:0.20},'SKU-A').eligible,true);
});
test('20 percent exception cannot pass with 25 percent approval',()=>{
 const costs={...base,costYen:1250};
 assert.equal(evaluateApprovedSkuMargin(costs,evidence,{source:'server',approved:true,sku:'SKU-A',minimumMargin:0.25},'SKU-A').eligible,false);
 assert.equal(evaluateApprovedSkuMargin(costs,evidence,{source:'server',approved:true,sku:'SKU-A',minimumMargin:0.20},'SKU-A').eligible,true);
});
test('unverified evidence and below 20 percent always reject',()=>{
 const approval={source:'server',approved:true,sku:'SKU-A',minimumMargin:0.20};
 assert.equal(evaluateApprovedSkuMargin(base,{},approval,'SKU-A').eligible,false);
 assert.equal(evaluateApprovedSkuMargin({...base,costYen:1400},evidence,approval,'SKU-A').eligible,false);
});

test('malformed or ambiguous SKU identities cannot authorize an exception',()=>{
 const approvalFor=sku=>({source:'server',approved:true,sku,minimumMargin:0.20});
 for(const sku of ['', ' ', ' SKU-A', 'SKU-A ', 'SKU-A\n', 'SKU-A\u0000', 'X'.repeat(161)]) {
  assert.equal(evaluateApprovedSkuMargin({...base,costYen:1250},evidence,approvalFor(sku),sku).eligible,false,JSON.stringify(sku));
 }
 assert.equal(evaluateApprovedSkuMargin({...base,costYen:1250},evidence,approvalFor('SKU-A'),'SKU-A').eligible,true);
});
test('server approval cannot replace verified shipping or fee evidence',()=>{
 const approval={source:'server',approved:true,sku:'SKU-A',minimumMargin:0.20};
 for(const proof of [{feeEvidenceVerified:true},{shippingEvidenceVerified:true},{}]) {
  assert.equal(evaluateApprovedSkuMargin(base,proof,approval,'SKU-A').eligible,false);
 }
});

test('exception approval fails closed for malformed approval thresholds and identity',()=>{
 const costs={...base,costYen:1250};
 for(const minimumMargin of [undefined,null,0,0.19,0.2+'',25,NaN,Infinity]) {
  const approval={source:'server',approved:true,sku:'SKU-A',minimumMargin};
  assert.equal(evaluateApprovedSkuMargin(costs,evidence,approval,'SKU-A').eligible,false,String(minimumMargin));
 }
 for(const sku of ['SKU-A\u200b','SKU-A\ufeff']) {
  // Invisible characters must never match a distinct canonical SKU approval.
  assert.equal(evaluateApprovedSkuMargin(costs,evidence,{source:'server',approved:true,sku:'SKU-A',minimumMargin:0.20},sku).eligible,false);
 }
});
test('unverified evidence is never bypassed by a valid standard margin',()=>{
 const costs={...base,costYen:1000};
 for(const proof of [{feeEvidenceVerified:true},{shippingEvidenceVerified:true},{feeEvidenceVerified:1,shippingEvidenceVerified:true},{}]) {
  assert.equal(evaluateApprovedSkuMargin(costs,proof,null,'SKU-A').eligible,false);
 }
});

test('matching invisible Unicode SKU identities never authorize reduced margin',()=>{
 const approvalFor=sku=>({source:'server',approved:true,sku,minimumMargin:0.20});
 for(const sku of ['SKU-A\u200b','SKU-A\ufeff','SKU-A\u2060','SKU-A\u00a0','SKU-A\u2028','SKU-A\u2029','SKU-A\u2003']) {
  assert.equal(evaluateApprovedSkuMargin({...base,costYen:1250},evidence,approvalFor(sku),sku).eligible,false,JSON.stringify(sku));
 }
 assert.equal(evaluateApprovedSkuMargin({...base,costYen:1250},evidence,approvalFor('SKU-A'),'SKU-A').eligible,true);
});
