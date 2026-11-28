'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {summarizeDiscovery}=require('../lib/cj-discovery-diagnostics.cjs');
const item=(id,listedNum=10,verifiedInventory=null)=>({id,listedNum,verifiedInventory});
test('CJ zero response is distinguishable from filter rejection',()=>{
 const d=summarizeDiscovery({received:[],products:[]}).diagnostics;
 assert.equal(d.zeroResultReason,'cj_returned_no_products');
 assert.equal(d.returnedCandidates,0);
});
test('invalid product identifiers are diagnosed',()=>{
 const d=summarizeDiscovery({received:[{},{}],products:[]}).diagnostics;
 assert.equal(d.zeroResultReason,'missing_or_invalid_product_ids');
 assert.equal(d.missingProductId,2);
});
test('listing gate rejection is reported',()=>{
 const d=summarizeDiscovery({received:[{}],products:[item('A',1)],minListed:5}).diagnostics;
 assert.equal(d.zeroResultReason,'listing_count_gate');
 assert.equal(d.excludedByListingCount,1);
});
test('discovery inventory gate is not mistaken for verified SKU stock',()=>{
 const d=summarizeDiscovery({received:[{}],products:[item('A',10,null)],minVerifiedInventory:5}).diagnostics;
 assert.equal(d.zeroResultReason,'discovery_inventory_gate');
 assert.equal(d.excludedByDiscoveryInventory,1);
});
test('discovery candidates remain blocked pending SKU-level evidence',()=>{
 const d=summarizeDiscovery({received:[{}],products:[item('A',10,9)],minVerifiedInventory:5}).diagnostics;
 assert.equal(d.zeroResultReason,null);
 assert.equal(d.blockedByUnverifiedEvidence,1);
 assert.equal(d.variantStockVerified,false);
 assert.equal(d.netProfitVerified,false);
});

test('invalid IDs are not incorrectly counted as duplicates',()=>{
 const d=summarizeDiscovery({received:[{id:'A'},{id:null},{id:'A'},{id:'B'}],products:[item('A'),{id:null},item('A'),item('B')]}).diagnostics;
 assert.equal(d.uniqueCandidates,2);
 assert.equal(d.duplicateIds,1);
 assert.equal(d.returnedCandidates,2);
});
test('multiple missing IDs are not reported as duplicate products',()=>{
 const d=summarizeDiscovery({received:[{},{}],products:[{},{}]}).diagnostics;
 assert.equal(d.duplicateIds,0);
 assert.equal(d.uniqueCandidates,0);
 assert.equal(d.zeroResultReason,'missing_or_invalid_product_ids');
});
