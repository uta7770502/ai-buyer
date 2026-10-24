import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../lib/routes/cj-shopify-stock-sync.js',import.meta.url),'utf8');

test('stock sync is dry-run by default and requires an explicit feature flag to apply',()=>{
  assert.match(source,/const apply=req\.method==='POST'&&String\(req\.query\?\.apply\|\|''\)==='true'/);
  assert.match(source,/CJ_SHOPIFY_STOCK_SYNC_ENABLED!=='true'/);
  assert.match(source,/mode:apply\?'apply':'dry-run'/);
  assert.match(source,/readOnly:!apply/);
});

test('stock sync requires admin authorization',()=>{
  assert.match(source,/AI_BUYER_ADMIN_KEY/);
  assert.match(source,/authorization!=='Bearer '\+admin/);
});

test('stock sync uses verified CJ warehouse inventory only',()=>{
  assert.match(source,/verifiedWarehouse\)===1/);
  assert.match(source,/totalInventoryNum\?\?x\.totalInventory/);
});

test('stock sync refuses ambiguous or missing Shopify inventory locations',()=>{
  assert.match(source,/levels\.length!==1/);
  assert.match(source,/multiple-inventory-locations/);
  assert.match(source,/inventory-location-missing/);
});

test('inventory writes use compare-and-swap protection and stay on available quantity',()=>{
  assert.match(source,/name:'available'/);
  assert.match(source,/changeFromQuantity:current/);
  assert.match(source,/quantity:stock\.total/);
  assert.match(source,/inventorySetQuantities/);
});

test('supplier stock failures never write a zero to Shopify',()=>{
  assert.match(source,/if\(!stock\.ok\).*cj-stock-unavailable/);
  const failureIndex=source.indexOf("cj-stock-unavailable");
  const mutationIndex=source.indexOf("inventorySetQuantities(input:$input)");
  assert.ok(failureIndex>-1&&mutationIndex>-1);
});

test('only draft ODDLY or AI BUYER products are targeted',()=>{
  assert.match(source,/status:draft/);
  assert.match(source,/vendor:ODDLY/);
  assert.match(source,/AI BUYER/);
});
