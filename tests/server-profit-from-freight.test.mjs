import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../lib/profit-estimate.js',import.meta.url),'utf8');
const wrapper=readFileSync(new URL('../lib/server-profit-from-freight.js',import.meta.url),'utf8').replace("'./profit-estimate.js'",JSON.stringify('data:text/javascript;charset=utf-8,'+encodeURIComponent(src)));
const {estimateProfitFromServerFreight}=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(wrapper));
const now=Date.parse('2026-10-24T00:00:00Z');
const freight={ok:true,quoteSource:'cj-server',destination:'JP',currency:'USD',vid:'v1',shippingJpyVerified:true,fxVerified:true,fxSource:'open.er-api.com',fetchedAt:new Date(now-1000).toISOString(),fxVerifiedAt:new Date(now-1000).toISOString(),shippingCostJpy:632,usdJpyRate:150,options:[{name:'CJ',usd:4.21,jpy:632}]};
const costs={salePriceJpy:3000,productCostJpy:900,paymentFeeRatePercent:3.6,paymentFixedFeeJpy:0,adCostPerOrderJpy:400,returnReservePerOrderJpy:100};
test('server-verified CJ freight yields profit',()=>{const r=estimateProfitFromServerFreight(freight,costs,{now,expectedVid:'v1'});assert.equal(r.ready,true);assert.equal(r.profitJpy,860)});
test('mismatched variant and tampered yen quote are blocked',()=>{
 assert.equal(estimateProfitFromServerFreight(freight,costs,{now,expectedVid:'v2'}).ready,false);
 assert.equal(estimateProfitFromServerFreight({...freight,shippingCostJpy:100},costs,{now,expectedVid:'v1'}).ready,false);
});
test('expired quote and absent FX verification are blocked',()=>{
 assert.equal(estimateProfitFromServerFreight({...freight,fetchedAt:new Date(now-3600000).toISOString()},costs,{now,expectedVid:'v1'}).ready,false);
 assert.equal(estimateProfitFromServerFreight({...freight,fxVerified:false},costs,{now,expectedVid:'v1'}).ready,false);
});
