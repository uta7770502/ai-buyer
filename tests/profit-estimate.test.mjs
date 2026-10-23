import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/profit-estimate.js',import.meta.url),'utf8');
const {estimateProfit}=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));

const base={salePriceJpy:3000,productCostJpy:900,shippingCostJpy:500,shippingVerified:true,paymentFeeRatePercent:3.6,paymentFixedFeeJpy:0,adCostPerOrderJpy:400,returnReservePerOrderJpy:100};

test('calculates profit only with all cost components',()=>{
  const result=estimateProfit(base);
  assert.equal(result.ready,true);
  assert.equal(result.profitJpy,992);
  assert.equal(result.marginPercent,33.1);
});
test('unknown shipping is not zero',()=>{
  const result=estimateProfit({...base,shippingCostJpy:null});
  assert.equal(result.ready,false);
  assert.equal(result.profitJpy,null);
});
test('browser quote cannot establish verified shipping',()=>{
  assert.equal(estimateProfit({...base,shippingVerified:false}).ready,false);
});
test('missing ad cost prevents final profit',()=>{
  assert.equal(estimateProfit({...base,adCostPerOrderJpy:undefined}).ready,false);
});
test('negative margin is reported rather than concealed',()=>{
  const result=estimateProfit({...base,productCostJpy:4000});
  assert.equal(result.ready,true);
  assert.ok(result.profitJpy<0);
});

test('missing fixed payment fee prevents final profit',()=>{
  const result=estimateProfit({...base,paymentFixedFeeJpy:undefined});
  assert.equal(result.ready,false);
  assert.ok(result.missing.includes('決済固定手数料'));
});
test('zero fixed fee is allowed when explicitly specified',()=>{
  assert.equal(estimateProfit({...base,paymentFixedFeeJpy:0}).ready,true);
});
test('negative or invalid fixed fee is rejected',()=>{
  assert.equal(estimateProfit({...base,paymentFixedFeeJpy:-100}).ready,false);
  assert.equal(estimateProfit({...base,paymentFixedFeeJpy:'abc'}).ready,false);
});
