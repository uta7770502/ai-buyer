// Pure regression tests; no external APIs or production side effects.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifiedProfit } = require('../lib/verified-profit.cjs');

const baseline = Object.freeze({
  salePriceJpy: 2000, productCostJpy: 800, shippingJpy: 300,
  paymentFeeJpy: 100, platformFeeJpy: 100, plannedAdCostJpy: 100,
  returnReserveJpy: 100, costSourceVerified: true,
  jpShippingVerified: true, feesVerified: true
});

test('verification flags accept only boolean true, never truthy substitutes', () => {
  for (const key of ['costSourceVerified', 'jpShippingVerified', 'feesVerified']) {
    for (const value of ['true', 'verified', 1, {}, [], null, undefined, false]) {
      const result = verifiedProfit({ ...baseline, [key]: value });
      assert.equal(result.finalProfitVerified, false, key + ':' + String(value));
      assert.equal(result.reason, 'verification_missing');
    }
  }
});

test('all money fields reject missing, fractional, string, negative and unsafe values', () => {
  for (const key of ['salePriceJpy', 'productCostJpy', 'shippingJpy',
    'paymentFeeJpy', 'platformFeeJpy', 'plannedAdCostJpy', 'returnReserveJpy']) {
    for (const value of [undefined, null, '100', 0.5, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const result = verifiedProfit({ ...baseline, [key]: value });
      assert.equal(result.finalProfitVerified, false, key + ':' + String(value));
      assert.equal(result.reason, 'invalid_amount');
    }
  }
});

test('zero selling price and unsafe aggregate costs fail closed', () => {
  assert.equal(verifiedProfit({ ...baseline, salePriceJpy: 0 }).reason, 'invalid_amount');
  const overflow = verifiedProfit({ ...baseline,
    productCostJpy: Number.MAX_SAFE_INTEGER, shippingJpy: 1 });
  assert.equal(overflow.finalProfitVerified, false);
  assert.equal(overflow.reason, 'unsafe_cost_total');
});

test('net margin is calculated after all deductions, not gross product margin', () => {
  const result = verifiedProfit(baseline);
  assert.equal(result.finalProfitJpy, 500);
  assert.equal(result.verifiedContributionMarginPercent, 25);
  assert.equal(result.finalProfitVerified, true);
});

test('30/25/20 percent margin boundaries are derived from verified net costs', () => {
  for (const [productCostJpy, expectedMargin] of [[700, 30], [800, 25], [900, 20]]) {
    const result = verifiedProfit({ ...baseline, productCostJpy });
    assert.equal(result.finalProfitVerified, true);
    assert.equal(result.verifiedContributionMarginPercent, expectedMargin);
    assert.equal(result.finalProfitJpy, 2000 * expectedMargin / 100);
  }
});

test('a mathematically sufficient margin never overrides missing evidence', () => {
  const highMargin = { ...baseline, productCostJpy: 0, shippingJpy: 0 };
  for (const missing of ['costSourceVerified', 'jpShippingVerified', 'feesVerified']) {
    const result = verifiedProfit({ ...highMargin, [missing]: false });
    assert.equal(result.finalProfitVerified, false);
    assert.equal(result.reason, 'verification_missing');
  }
});

test('negative and zero net profit are never reported as positive profit', () => {
  const zero = verifiedProfit({ ...baseline, productCostJpy: 1300 });
  const negative = verifiedProfit({ ...baseline, productCostJpy: 1301 });
  assert.equal(zero.finalProfitJpy, 0);
  assert.equal(zero.reason, 'non_positive_profit');
  assert.equal(negative.finalProfitJpy, -1);
  assert.equal(negative.reason, 'non_positive_profit');
});
