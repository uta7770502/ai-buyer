import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const asData=s=>'data:text/javascript;charset=utf-8,'+encodeURIComponent(s);
const freightSource=readFileSync(new URL('../lib/cj-freight-quote.js',import.meta.url),'utf8');
const profitSource=readFileSync(new URL('../lib/profit-estimate.js',import.meta.url),'utf8');
const previewSource=readFileSync(new URL('../lib/cj-profit-preview.js',import.meta.url),'utf8')
  .replace("'./cj-freight-quote.js'",JSON.stringify(asData(freightSource)))
  .replace("'./profit-estimate.js'",JSON.stringify(asData(profitSource)));
const {estimateProfitFromCjQuote}=await import(asData(previewSource));
const now=Date.parse('2026-10-24T00:00:00Z');
const quote={ok:true,quoteSource:'cj-server',currency:'USD',destination:'JP',vid:'v1',
 fetchedAt:new Date(now-60000).toISOString(),usdJpyRate:150,fxVerified:true,
 fxVerifiedAt:new Date(now-60000).toISOString(),selectedMethod:'CJ Packet',
 options:[{name:'CJ Packet',usd:4.21}]};
const costs={salePriceJpy:3000,productCostJpy:900,paymentFeeRatePercent:3.6,
 paymentFixedFeeJpy:0,adCostPerOrderJpy:400,returnReservePerOrderJpy:100};
test('real CJ preview calculation remains unverified',()=>{
 const r=estimateProfitFromCjQuote(quote,costs,{expectedVid:'v1',now});
 assert.equal(r.freight.shippingCostJpy,632);
 assert.equal(r.freight.verified,false);
 assert.equal(r.profit.ready,false);
 assert.equal(r.profit.profitJpy,null);
 assert.equal(r.requiresServerVerification,true);
});
test('wrong CJ variant does not provide a shipping estimate',()=>{
 const r=estimateProfitFromCjQuote(quote,costs,{expectedVid:'v2',now});
 assert.equal(r.freight.shippingCostJpy,null);
 assert.equal(r.profit.ready,false);
});
test('stale CJ freight quote never finalizes profit',()=>{
 const r=estimateProfitFromCjQuote({...quote,fetchedAt:new Date(now-3600000).toISOString()},costs,{expectedVid:'v1',now});
 assert.equal(r.freight.shippingCostJpy,null);
 assert.equal(r.profit.profitJpy,null);
});
