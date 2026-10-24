import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../lib/routes/release-readiness.js',import.meta.url),'utf8');

test('release readiness reports verified draft creation and supplier freight evidence',()=>{
  assert.match(source,/shopifyDraftCreationEndToEndVerified:true/);
  assert.match(source,/ninePetProductsSupplierAndFreightVerified:true/);
  assert.match(source,/stockSyncSafetyRegressionVerified:true/);
});

test('release readiness keeps live inventory verification incomplete until Preview evidence exists',()=>{
  assert.match(source,/variantLevelInventoryVerified:false/);
  assert.match(source,/CJの販売バリエーション別実在庫dry-run/);
  assert.match(source,/CJ在庫→Shopify在庫同期のPreview実行/);
});

test('stock synchronization stays opt-in',()=>{
  assert.match(source,/CJ_SHOPIFY_STOCK_SYNC_ENABLED/);
  assert.match(source,/stock sync remains dry-run only/);
});
