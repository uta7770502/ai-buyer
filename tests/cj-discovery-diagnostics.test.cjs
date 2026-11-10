const {test}=require('node:test');
const assert=require('node:assert/strict');
const {summarizeDiscovery}=require('../lib/cj-discovery-diagnostics.cjs');
test('diagnostic stages account for missing IDs, duplicates, listing and inventory rejections',()=>{
 const received=[{id:'a'},{id:'a'},{id:'b'},{id:'c'},{name:'missing'}];
 const products=[{id:'a',listedNum:10,verifiedInventory:5},{id:'a',listedNum:10,verifiedInventory:5},{id:'b',listedNum:1,verifiedInventory:10},{id:'c',listedNum:10,verifiedInventory:null}];
 const r=summarizeDiscovery({received,products,minListed:5,minVerifiedInventory:5});
 assert.deepEqual(r.products.map(p=>p.id),['a']);
 assert.deepEqual([r.diagnostics.receivedFromCJ,r.diagnostics.missingProductId,r.diagnostics.duplicateIds,r.diagnostics.excludedByListingCount,r.diagnostics.excludedByDiscoveryInventory,r.diagnostics.returnedCandidates],[5,1,1,1,1,1]);
});
test('unknown inventory never passes a positive discovery threshold',()=>{
 const r=summarizeDiscovery({received:[{}],products:[{id:'x',listedNum:2,verifiedInventory:undefined}],minVerifiedInventory:5});
 assert.equal(r.products.length,0);assert.equal(r.diagnostics.variantStockVerified,false);
});
test('discovery candidates never imply verified stock, reviews, freight or profit',()=>{
 const r=summarizeDiscovery({received:[{id:'a'}],products:[{id:'a',listedNum:1,verifiedInventory:50}]});
 assert.equal(r.products.length,1);
 for(const k of ['reviewVerified','variantStockVerified','jpFreightVerified','netProfitVerified'])assert.equal(r.diagnostics[k],false);
});
