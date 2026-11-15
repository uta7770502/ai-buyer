import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateApprovedSkuMargin} from '../lib/adps-approved-sku-margin.mjs';
const evidence={feeEvidenceVerified:true,shippingEvidenceVerified:true};
const base={priceYen:2000,costYen:1150,shippingYen:200,percentageFee:0.035};
test('30 percent needs no exception',()=>{
 assert.equal(evaluateApprovedSkuMargin({...base,costYen:1000},evidence,null,'SKU-A').eligible,true);
});
test('25 percent requires matching server approval',()=>{
 for(const approval of [null,{approved:true,sku:'SKU-A',minimumMargin:0.25},{source:'server',approved:true,sku:'SKU-B',minimumMargin:0.25},{source:'server',approved:'true',sku:'SKU-A',minimumMargin:0.25},{source:'server',approved:true,sku:'SKU-A',minimumMargin:0.20}]) {
  const r=evaluateApprovedSkuMargin(base,evidence,approval,'SKU-A');
  if(approval?.source==='server'&&approval?.minimumMargin===0.20&&approval?.sku==='SKU-A') assert.equal(r.eligible,true);
  else assert.equal(r.eligible,false);
 }
 assert.equal(evaluateApprovedSkuMargin(base,evidence,{source:'server',approved:true,sku:'SKU-A',minimumMargin:0.25},'SKU-A').eligible,true);
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
