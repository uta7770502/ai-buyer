import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/routes/cj-search.js',import.meta.url),'utf8');
test('CJ discovery listings never claim variant stock, freight or profit verification',()=>{
 for(const key of ['variantInventoryVerified','freightVerified','profitVerified','readyForShopifyDraft'])assert.match(source,new RegExp(key+':false'));
});
test('CJ search deduplicates product IDs before presenting candidates',async()=>{
 assert.match(source,/summarizeDiscovery/);
 const {createRequire}=await import('node:module');
 const require=createRequire(import.meta.url);
 const {summarizeDiscovery}=require('../lib/cj-discovery-diagnostics.cjs');
 const result=summarizeDiscovery({received:[{id:'a'},{id:'a'}],products:[{id:'a',listedNum:10},{id:'a',listedNum:20}]});
 assert.equal(result.products.length,1);
 assert.equal(result.products[0].listedNum,20);
});
