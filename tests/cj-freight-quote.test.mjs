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
