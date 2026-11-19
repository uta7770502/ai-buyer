const test=require('node:test');
const assert=require('node:assert/strict');
const {summarizeDiscovery}=require('../lib/cj-discovery-diagnostics.cjs');
test('CJ pid and productId are normalized and deduplicated',()=>{
 const input=[{pid:'p1',listedNum:3},{productId:'p2',listedNum:3},{id:'p1',listedNum:3}];
 const {products,diagnostics}=summarizeDiscovery({received:input,products:input});
 assert.equal(products.length,2);
 assert.deepEqual(products.map(p=>p.id).sort(),['p1','p2']);
 assert.equal(diagnostics.duplicateIds,1);
 assert.equal(diagnostics.reviewVerified,false);
 assert.equal(diagnostics.variantStockVerified,false);
 assert.equal(diagnostics.jpFreightVerified,false);
 assert.equal(diagnostics.netProfitVerified,false);
});
test('malformed IDs cannot pass discovery',()=>{
 const {products,diagnostics}=summarizeDiscovery({received:[{},null,{pid:' '}],products:[{},null,{pid:' '}]});
 assert.equal(products.length,0);
 assert.equal(diagnostics.zeroResultReason,'missing_or_invalid_product_ids');
});
