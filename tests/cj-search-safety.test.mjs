import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/routes/cj-search.js',import.meta.url),'utf8');
test('CJ discovery listings never claim variant stock, freight or profit verification',()=>{
 for(const key of ['variantInventoryVerified','freightVerified','profitVerified','readyForShopifyDraft'])assert.match(source,new RegExp(key+':false'));
});
test('CJ search deduplicates product IDs before presenting candidates',()=>{
 assert.match(source,/new Map\(products\.map\(p=>\[String\(p\.id\),p\]\)\)/);
});
