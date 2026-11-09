import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../api/shopify-publish.js', import.meta.url), 'utf8');

test('CJ stock is verified on the server before Shopify DRAFT creation', () => {
  const priceGuard = source.indexOf('!Number.isSafeInteger(price)||price<=0||price>10000000');
  const supplierLookup = source.indexOf('const cj=await cjVariant(p.cjProductId||p.id,p.cjVariantId||p.vid)');
  const stockLookup = source.indexOf('const stock=await cjVariantStock(cj.vid)');
  const stockGate = source.indexOf('if(stock.total<MIN_LAUNCH_INVENTORY)');
  const createDraft = source.indexOf("status:'DRAFT',tags:productTags");
  assert.ok(priceGuard >= 0 && supplierLookup > priceGuard);
  assert.ok(stockLookup > supplierLookup && stockGate > stockLookup);
  assert.ok(createDraft > stockGate);
});

test('unverified review evidence and Japan shipping cannot authorize publication', () => {
  assert.match(source, /const reviewsVerified=false;/);
  assert.match(source, /const japanShippingVerified=false;/);
  assert.match(source, /if\(p\.publishApproved===true&&!safetyReady\)/);
  assert.match(source, /publicationBlocked:true/);
});

test('live activation requires a separate server-side environment gate', () => {
  assert.match(source, /process\.env\.SHOPIFY_LIVE_PUBLISH_ENABLED==='true'/);
  assert.match(source, /if\(p\.publishApproved!==true\|\|!livePublishEnabled\)/);
  assert.match(source, /status:'DRAFT'/);
});

test('Shopify variant price is checked after writing and draft retained on mismatch', () => {
  assert.match(source, /const confirmedPrice=Number\(updatedVariant\?\.price\)/);
  assert.match(source, /Shopify価格の反映確認に失敗しました。下書きを保持します。/);
});
