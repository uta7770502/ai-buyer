import test from 'node:test';
import assert from 'node:assert/strict';
import './stock-audit-summary.test.mjs';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../lib/routes/cj-shopify-stock-sync.js',import.meta.url),'utf8');
const summarySource=readFileSync(new URL('../lib/stock-audit-summary.js',import.meta.url),'utf8');

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
  assert.match(source,/validateCJStockResponse\(j\)/);
  assert.match(source,/cj-stock-validation\.js/);
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

test('stock sync refuses unsafe inventory policy and unverified current quantities',()=>{
  assert.match(source,/v\.inventoryPolicy!=='DENY'/);
  assert.match(source,/inventory-policy-not-deny/);
  assert.match(source,/Number\.isSafeInteger\(rawCurrent\)/);
  assert.match(source,/shopify-stock-unverified/);
  assert.doesNotMatch(source,/quantity\|\|0/);
});

test('stock sync stops before writes if product, variant or location pagination is incomplete',()=>{
  assert.match(source,/pageInfo\{hasNextPage\}/);
  assert.match(source,/data\?\.products\?\.pageInfo\?\.hasNextPage/);
  assert.match(source,/p\.variants\?\.pageInfo\?\.hasNextPage/);
  assert.match(source,/v\.inventoryItem\.inventoryLevels\.pageInfo\.hasNextPage/);
  assert.match(source,/Inventory audit incomplete: pagination required before stock sync/);
  assert.ok(source.indexOf('const incomplete=')<source.indexOf('for(const p of products)'));
});

test('stock sync never reports applied when Shopify mutation response is missing',()=>{
  assert.match(source,/const result=out\?\.inventorySetQuantities/);
  assert.match(source,/!result\|\|!Array\.isArray\(errors\)/);
  assert.match(source,/result\.inventoryAdjustmentGroup\?\.createdAt/);
  assert.match(source,/shopify-inventory-result-unverified/);
  assert.doesNotMatch(source,/const errors=out\?\.inventorySetQuantities\?\.userErrors\|\|\[\]/);
});

test('stock sync requires complete Shopify connection metadata before mutation',()=>{
  assert.match(source,/!Array\.isArray\(data\?\.products\?\.nodes\)/);
  assert.match(source,/typeof data\?\.products\?\.pageInfo\?\.hasNextPage!=='boolean'/);
  assert.match(source,/!Array\.isArray\(p\.variants\?\.nodes\)/);
  assert.match(source,/!Array\.isArray\(v\.inventoryItem\?\.inventoryLevels\?\.nodes\)/);
  assert.match(source,/typeof v\.inventoryItem\.inventoryLevels\.pageInfo\?\.hasNextPage!=='boolean'/);
});

test('stock sync summary counts confirmed applied stock as synchronized',()=>{
  assert.match(source,/effectiveShopifyStock:applied\?stock\.total:current/);
  assert.match(source,/summarizeStockAudit\(rows\)/);
  assert.match(summarySource,/row\.cjStock===row\.effectiveShopifyStock/);
  assert.match(summarySource,/row\.cjStock!==row\.effectiveShopifyStock/);
});

test('stock sync refuses inventory targets without Shopify resource identifiers',()=>{
  assert.match(source,/InventoryItem/);
  assert.match(source,/Location/);
  assert.match(source,/inventory-target-unverified/);
  assert.ok(source.indexOf('inventory-target-unverified')<source.indexOf('const rawCurrent='));
});

test('stock mutation prioritizes Shopify user errors over missing success metadata',()=>{
  const errorBranch=source.indexOf('if(Array.isArray(errors)&&errors.length)');
  const missingBranch=source.indexOf('}else if(!result||!Array.isArray(errors)');
  assert.ok(errorBranch>=0&&missingBranch>errorBranch);
  assert.match(source,/errors\.map\(x=>x\?\.message\)\.filter\(Boolean\)/);
});

test('stock sync verifies returned draft status and approved vendor before any supplier lookup',()=>{
  assert.match(source,/id title status vendor/);
  assert.match(source,/p\.status!=='DRAFT'/);
  assert.match(source,/\['ODDLY','AI BUYER'\]\.includes\(p\.vendor\)/);
  assert.match(source,/product-not-approved-draft/);
  assert.ok(source.indexOf("p.status!=='DRAFT'")<source.indexOf('const stock=await cjStock'));
});

test('stock sync rejects malformed Shopify GraphQL envelopes before trusting inventory data',()=>{
  assert.match(source,/Object\.hasOwn\(j,'errors'\)/);
  assert.match(source,/!Array\.isArray\(j\.errors\)\|\|j\.errors\.length>0/);
  assert.match(source,/!j\.data\|\|typeof j\.data!=='object'\|\|Array\.isArray\(j\.data\)/);
  assert.ok(source.indexOf('Shopify GraphQL failed')<source.indexOf('const productsQuery='));
});

test('stock sync refuses missing or duplicate available inventory quantities',()=>{
  assert.match(source,/Array\.isArray\(level\.quantities\)/);
  assert.match(source,/level\.quantities\.filter\(x=>x\?\.name==='available'\)/);
  assert.match(source,/available\.length!==1/);
  assert.match(source,/const rawCurrent=available\[0\]\.quantity/);
});

test('stock sync exposes incomplete row audits explicitly',()=>{
  assert.match(source,/summarizeStockAudit\(rows\)/);
  assert.match(summarySource,/partial:blocked>0/);
  assert.match(summarySource,/noAuditableVariants:rows\.length===0/);
  assert.match(summarySource,/allVerified:rows\.length>0&&blocked===0/);
});
