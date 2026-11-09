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
  assert.match(source, /!Number\.isSafeInteger\(confirmedPrice\)\|\|confirmedPrice!==price/);
  assert.match(source, /ShopifyバリエーションID・価格の反映確認に失敗しました。下書きを保持します。/);
  assert.match(source, /updatedVariant\?\.id!==variantId/);
});

test('DRAFT profit gate remains false until server-side settlement evidence exists',()=>{
 assert.match(source,/const draftProfitVerified=false;/);
 assert.match(source,/const draftRecommendationEligible=false;/);
 assert.match(source,/if\(!draftProfitVerified\)safetyReasons\.push/);
 assert.match(source,/draftProfitVerified,draftRecommendationEligible,draftProfitVerificationReason,livePublishEnabled/);
});

test('resume cannot activate a DRAFT without server-verified readiness',()=>{
 const guard=source.indexOf("if(syncAction==='resume')return res.status(409)");
 const activate=source.indexOf("const status=syncAction==='stop'?'DRAFT':'ACTIVE'");
 assert.ok(guard>=0&&activate>guard);
 assert.match(source,/publicationBlocked:true,status:targetProduct.status/);
});

test('price synchronization checks JPY shop and safe integer bounds',()=>{
 assert.match(source,/!Number\.isSafeInteger\(syncPrice\)\|\|syncPrice<=0\|\|syncPrice>10000000/);
 assert.match(source,/query VerifyPriceCurrency \{ shop \{ currencyCode myshopifyDomain \} \}/);
 assert.match(source,/priceShop\?\.shop\?\.currencyCode!=='JPY'/);
});

test('recommendation-to-draft mode rejects simultaneous publish approval',()=>{
 const gate=source.indexOf("if(recommendationToDraft&&p.publishApproved===true)");
 const draft=source.indexOf("status:'DRAFT',tags:productTags");
 assert.ok(gate>=0&&draft>gate);
 assert.match(source,/recommendationToDraft,metadataReady:true,safetyReady/);
});

test('selected-product UI calls recommendation-to-DRAFT with publish disabled',()=>{
 const ui=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(ui,/images,recommendationToDraft:true,publishApproved:false,\.\.\.buildAioPublishMeta\(x\)/);
 assert.match(ui,/fetch\('\/api\/shopify-publish',\{method:'POST'/);
});

test('UI only marks recommendation as registered after a DRAFT-only response',()=>{
 const ui=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(ui,/j\.status!=='DRAFT'\|\|j\.published!==false\|\|!j\.productId\|\|!j\.variantId\|\|j\.recommendationToDraft!==true/);
 const verified=ui.indexOf("if(j.status!=='DRAFT'||j.published!==false");
 const marked=ui.indexOf("x.shopifyPublishState=j.published?'published':'created'");
 assert.ok(verified>=0&&marked>verified);
});

test('Shopify returned product must be DRAFT before variant price updates',()=>{
 const check=source.indexOf("if(ce.product.status!=='DRAFT')");
 const variant=source.indexOf("const variantId=ce.product.variants?.nodes?.[0]?.id");
 assert.ok(check>=0&&variant>check);
});

test('Shopify DRAFT registration performs persisted status SKU and price read-back',()=>{
 assert.match(source,/query VerifyDraftPersisted\(\$id:ID!\)/);
 assert.match(source,/savedProduct\.status!=='DRAFT'/);
 assert.match(source,/String\(savedVariant\.sku\)!==String\(cj\.vid\)/);
 assert.match(source,/Number\(savedVariant\.price\)!==price/);
 const readBack=source.indexOf('query VerifyDraftPersisted');
 const success=source.indexOf("published:false,status:'DRAFT',recommendationToDraft");
 assert.ok(readBack>=0&&success>readBack);
});


test('persisted Shopify DRAFT must match requested product and exactly one variant',()=>{
 assert.match(source,/savedProduct\.id!==ce\.product\.id/);
 assert.match(source,/savedMatches\.length===1/);
 assert.match(source,/savedVariants\?\.pageInfo\?\.hasNextPage!==false/);
 assert.match(source,/status:'UNVERIFIED'/);
});

test('single-CJ-variant draft refuses unexpected additional persisted Shopify variants',()=>{
 assert.match(source,/const singleVariantPersisted=Array\.isArray\(savedVariants\?\.nodes\)&&savedVariants\.nodes\.length===1/);
 assert.match(source,/!savedVariant\|\|!singleVariantPersisted\|\|String\(savedVariant\.sku\)/);
});
