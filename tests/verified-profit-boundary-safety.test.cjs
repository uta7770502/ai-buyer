// Boundary and immutability regression checks for verified net profit.
// No network calls, Shopify writes, or CJ orders.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifiedProfit } = require('../lib/verified-profit.cjs');

const base = Object.freeze({
  salePriceJpy: 10000, productCostJpy: 5000, shippingJpy: 1000,
  paymentFeeJpy: 300, platformFeeJpy: 200, plannedAdCostJpy: 500,
  returnReserveJpy: 500, costSourceVerified: true,
  jpShippingVerified: true, feesVerified: true
});

test('net margin drops below 30 percent when one yen of cost is added', () => {
  const exactly = verifiedProfit({ ...base, productCostJpy: 5000 });
  const below = verifiedProfit({ ...base, productCostJpy: 5001 });
  assert.equal(exactly.finalProfitJpy, 2500);
  assert.equal(exactly.verifiedContributionMarginPercent, 25);
  assert.equal(below.finalProfitJpy, 2499);
  assert.ok(below.verifiedContributionMarginPercent < 25);
  assert.ok(below.verifiedContributionMarginPercent > 20);
});

test('verified cost fields must be explicitly present even if assumed zero', () => {
  for (const key of ['plannedAdCostJpy', 'returnReserveJpy', 'platformFeeJpy']) {
    const { [key]: omitted, ...missing } = base;
    assert.equal(verifiedProfit(missing).reason, 'invalid_amount', key);
    const explicit = verifiedProfit({ ...base, [key]: 0 });
    assert.equal(explicit.finalProfitVerified, true, key);
  }
});

test('cost total at safe integer boundary is accepted, one yen beyond rejected', () => {
  const exact = verifiedProfit({ ...base, salePriceJpy: 10000,
    productCostJpy: Number.MAX_SAFE_INTEGER - 1,
    shippingJpy: 1, paymentFeeJpy: 0, platformFeeJpy: 0,
    plannedAdCostJpy: 0, returnReserveJpy: 0 });
  assert.equal(exact.finalProfitVerified, true);
  assert.equal(exact.reason, 'non_positive_profit');
  const overflow = verifiedProfit({ ...base, productCostJpy: Number.MAX_SAFE_INTEGER,
    shippingJpy: 1, paymentFeeJpy: 0, platformFeeJpy: 0,
    plannedAdCostJpy: 0, returnReserveJpy: 0 });
  assert.equal(overflow.finalProfitVerified, false);
  assert.equal(overflow.reason, 'unsafe_cost_total');
});

test('calculator never mutates verified input or leaks verified result on missing flags', () => {
  const frozen = Object.freeze({ ...base });
  const before = JSON.stringify(frozen);
  assert.equal(verifiedProfit(frozen).finalProfitVerified, true);
  assert.equal(JSON.stringify(frozen), before);
  for (const flag of ['costSourceVerified', 'jpShippingVerified', 'feesVerified']) {
    const result = verifiedProfit({ ...base, [flag]: false });
    assert.equal(result.finalProfitVerified, false);
    assert.equal(result.contributionMarginVerified, false);
    assert.equal(Object.hasOwn(result, 'verifiedContributionMarginPercent'), false);
  }
});
