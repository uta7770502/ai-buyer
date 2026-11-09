import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/cj-freight-quote.js',import.meta.url),'utf8');
const {normalizeCjFreightQuote}=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));
const now=Date.parse('2026-10-24T00:00:00Z');
const base={ok:true,destination:'JP',vid:'v1',fetchedAt:new Date(now-60000).toISOString(),usdJpyRate:150,fxVerified:true,fxVerifiedAt:new Date(now-60000).toISOString(),quoteSource:'cj-server',currency:'USD',selectedMethod:'CJ Packet',options:[{name:'CJ Packet',usd:4.21}]};
test('converts USD to JPY for preview only',()=>{
 const r=normalizeCjFreightQuote(base,{expectedVid:'v1',now});
 assert.equal(r.shippingCostJpy,632);
 assert.equal(r.verified,false);
});
test('rejects stale quotes',()=>assert.equal(normalizeCjFreightQuote({...base,fetchedAt:new Date(now-3600000).toISOString()},{expectedVid:'v1',now}).shippingCostJpy,null));
test('rejects unverified FX',()=>assert.equal(normalizeCjFreightQuote({...base,fxVerified:false},{expectedVid:'v1',now}).shippingCostJpy,null));
test('rejects variant mismatch',()=>assert.equal(normalizeCjFreightQuote(base,{expectedVid:'v2',now}).shippingCostJpy,null));
test('rejects absent shipping method',()=>assert.equal(normalizeCjFreightQuote({...base,selectedMethod:'other'},{expectedVid:'v1',now}).shippingCostJpy,null));

test('rejects a quote without server source evidence',()=>{
 assert.equal(normalizeCjFreightQuote({...base,quoteSource:'browser'},{expectedVid:'v1',now}).shippingCostJpy,null);
});
test('rejects expired FX evidence',()=>{
 assert.equal(normalizeCjFreightQuote({...base,fxVerifiedAt:new Date(now-3600000).toISOString()},{expectedVid:'v1',now}).shippingCostJpy,null);
});

test('CJ freight route verifies yen cost only when server FX is ready',()=>{
 const route=readFileSync(new URL('../lib/routes/cj-freight.js',import.meta.url),'utf8');
 assert.match(route,/shippingJpyVerified:fxReady/);
 assert.match(route,/shippingCostJpy:fxReady\?pricedOptions\[0\]\.jpy:null/);
 assert.match(route,/fxVerified:fxReady/);
 assert.match(route,/quoteExpiresInSeconds:900/);
});

test('freight endpoint refuses ambiguous multivariant product',()=>{
 const source=readFileSync(new URL('../lib/routes/cj-freight.js',import.meta.url),'utf8');
 assert.match(source,/!variantId&&validVariants\.length>1/);
 assert.match(source,/validVariants\.find\(v=>String\(v\.vid\|\|v\.id\|\|v\.variantId\)===variantId\)/);
});

test('freight endpoint refuses duplicated CJ variant IDs',()=>{
 const route=readFileSync(new URL('../lib/routes/cj-freight.js',import.meta.url),'utf8');
 assert.match(route,/new Set\(variantIds\)\.size!==variantIds\.length/);
 assert.match(route,/CJの商品バリエーションIDに重複があります/);
});

test('freight endpoint refuses CJ variants with missing IDs',()=>{
 const route=readFileSync(new URL('../lib/routes/cj-freight.js',import.meta.url),'utf8');
 assert.match(route,/validVariants\.length!==variants\.length/);
 assert.match(route,/CJの商品バリエーションIDが欠落しています/);
});

test('CJ freight endpoint rejects empty supplier variant lists',()=>{
 const endpoint=readFileSync(new URL('../lib/routes/cj-freight.js',import.meta.url),'utf8');
 assert.match(endpoint,/if\(!variants\.length\)return res\.status\(422\)/);
});

test('draft pricing must use authenticated selected-SKU supplier cost and never fall back to search prices',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=html.indexOf('async function autoPrepareSelectedProduct(');
 const end=html.indexOf('\nasync function ',start+20);
 const draft=html.slice(start,end<0?undefined:end);
 assert.match(draft,/data\.supplierPriceUsdVerified===true&&data\.supplierPriceSource==='cj-selected-variant'/);
 assert.match(draft,/Number\(data\.supplierPriceUsd\):NaN/);
 assert.doesNotMatch(draft,/x\.costUsd\?\?parsePrice\(x\.sellPrice\)/);
 assert.match(draft,/CJ選択SKUの仕入原価または為替レートが未検証/);
});
test('freight supplier quote belongs to selected CJ variant and is never asserted as final profit',()=>{
 const route=readFileSync(new URL('../lib/routes/cj-freight.js',import.meta.url),'utf8');
 assert.match(route,/const rawSupplierPrice=v\.variantSellPrice\?\?v\.sellPrice\?\?v\.price/);
 assert.match(route,/supplierPriceUsdVerified,supplierPriceUsd:supplierPriceUsdVerified/);
 assert.match(route,/supplierPriceSource:supplierPriceUsdVerified\?'cj-selected-variant':null/);
 assert.doesNotMatch(route,/finalProfitVerified:true/);
});

test('explicitly non-USD CJ supplier quotes cannot be treated as USD draft cost',()=>{
 const route=readFileSync(new URL('../lib/routes/cj-freight.js',import.meta.url),'utf8');
 assert.match(route,/declaredPriceCurrency=String\(v\.currency\|\|v\.currencyCode\|\|v\.priceCurrency\|\|p\.currency\|\|p\.currencyCode/);
 assert.match(route,/declaredPriceCurrency==='USD'/);
});

test('discovery simulation requires fresh CJ server freight and verified FX',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=html.indexOf('async function inspectDiscoveryVariantStock(');
 const end=html.indexOf('function renderDiscoveryPreview(',start);
 const block=html.slice(start,end);
 assert.match(block,/freight\.quoteSource==='cj-server'/);
 assert.match(block,/freight\.fxVerified===true/);
 assert.match(block,/freight\.currency==='USD'/);
 assert.match(block,/freight\.shippingJpyVerified===true/);
 assert.match(block,/Date\.now\(\)-Date\.parse\(freight\.fetchedAt\)<=15\*60\*1000/);
 assert.match(block,/p\.discoveryPriceLabel='CJ選択SKU原価を使用/);
});

test('missing CJ supplier currency must not be treated as USD',()=>{
 const route=readFileSync(new URL('../lib/routes/cj-freight.js',import.meta.url),'utf8');
 assert.match(route,/supplierPriceUsdVerified=typeof rawSupplierPrice!=='object'&&declaredPriceCurrency==='USD'/);
 assert.doesNotMatch(route,/!declaredPriceCurrency\|\|declaredPriceCurrency==='USD'/);
});


test('CJ freight options with explicit non-USD currency cannot be converted as USD',()=>{
 const route=readFileSync(new URL('../lib/routes/cj-freight.js',import.meta.url),'utf8');
 assert.match(route,/declaredCurrency=String\(x\.currency\|\|x\.currencyCode\|\|x\.priceCurrency\|\|''\)/);
 assert.match(route,/currencyCompatible:!declaredCurrency\|\|declaredCurrency==='USD'/);
 assert.match(route,/\.filter\(x=>x\.currencyCompatible&&Number\.isFinite\(x\.usd\)/);
});
