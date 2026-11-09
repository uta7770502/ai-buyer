'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifiedMarginAtLeast } = require('../lib/verified-profit.cjs');
const base = Object.freeze({ salePriceJpy:10000, productCostJpy:5000,
  shippingJpy:1000, paymentFeeJpy:300, platformFeeJpy:200,
  plannedAdCostJpy:500, returnReserveJpy:500,
  costSourceVerified:true, jpShippingVerified:true, feesVerified:true });

test('exact 30/25/20 thresholds pass and one-yen shortfalls fail', () => {
  for (const [threshold,cost] of [[30,4500],[25,5000],[20,5500]]) {
    assert.equal(verifiedMarginAtLeast({...base,productCostJpy:cost},threshold).allowed,true);
    assert.deepEqual(verifiedMarginAtLeast({...base,productCostJpy:cost+1},threshold),
      {allowed:false,reason:'margin_below_threshold'});
  }
});

test('missing evidence, zero profit and unsupported thresholds always fail closed', () => {
  for (const flag of ['costSourceVerified','jpShippingVerified','feesVerified']) {
    assert.equal(verifiedMarginAtLeast({...base,[flag]:false},20).allowed,false);
  }
  assert.equal(verifiedMarginAtLeast({...base,productCostJpy:7500},20).allowed,false);
  for (const threshold of [0,19,21,24,26,31,NaN,Infinity,'20',null]) {
    assert.deepEqual(verifiedMarginAtLeast(base,threshold),
      {allowed:false,reason:'invalid_threshold'});
  }
});

test('large safe integer inputs use exact comparisons without rounding', () => {
  const price = Number.MAX_SAFE_INTEGER;
  const common = {...base,salePriceJpy:price,shippingJpy:0,paymentFeeJpy:0,
    platformFeeJpy:0,plannedAdCostJpy:0,returnReserveJpy:0};
  const maxCost = price - Math.ceil(price*0.3);
  assert.equal(verifiedMarginAtLeast({...common,productCostJpy:maxCost},30).allowed,true);
  assert.equal(verifiedMarginAtLeast({...common,productCostJpy:maxCost+1},30).allowed,false);
});
