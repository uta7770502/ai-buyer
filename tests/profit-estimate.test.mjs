import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateProfit} from '../lib/profit-estimate.js';

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
