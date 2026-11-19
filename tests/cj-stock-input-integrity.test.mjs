import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCJStockResponse, classifyCJAvailability } from '../lib/cj-stock-validation.js';

const verify = (...rows) => validateCJStockResponse({ result: true, data: rows });
const row = (cj, factory) => ({ cjInventoryNum: cj, factoryInventoryNum: factory, totalInventoryNum: cj + factory });

test('empty supplier warehouse response cannot authorize stock', () => {
  assert.equal(validateCJStockResponse({ result: true, data: [] }).ok, false);
});

test('supplier success flag must be boolean true', () => {
  assert.equal(validateCJStockResponse({ result: 'true', data: [row(5, 0)] }).ok, false);
});

test('negative and fractional supplier quantities fail closed', () => {
  for (const value of [-1, 0.5, '1.5']) {
    assert.equal(verify({ cjInventoryNum: value, factoryInventoryNum: 0, totalInventoryNum: value }).ok, false);
  }
});

test('leading zero and exponential notation cannot masquerade as stock', () => {
  for (const value of ['05', '1e3', '+5']) {
    assert.equal(verify({ cjInventoryNum: value, factoryInventoryNum: 0, totalInventoryNum: value }).ok, false);
  }
});

test('cumulative CJ warehouse stock overflow fails closed', () => {
  assert.equal(verify(row(Number.MAX_SAFE_INTEGER, 0), row(1, 0)).ok, false);
});

test('cumulative factory stock overflow fails closed', () => {
  assert.equal(verify(row(0, Number.MAX_SAFE_INTEGER), row(0, 1)).ok, false);
});

test('zero CJ and zero factory quantities remain out of stock', () => {
  const stock = verify(row(0, 0));
  assert.equal(stock.ok, true);
  assert.equal(stock.recommendationStockStatus, 'out-of-stock');
  assert.equal(classifyCJAvailability(stock).recommendationEligible, false);
});

test('a custom threshold never converts factory stock into Shopify available stock', () => {
  const stock = verify(row(2, 1));
  const availability = classifyCJAvailability(stock, 3);
  assert.equal(availability.recommendationEligible, true);
  assert.equal(availability.shopifyAvailable, 2);
  assert.equal(availability.requiresFactoryReplenishment, true);
});

test('invalid minimum stock thresholds are rejected', () => {
  const stock = verify(row(5, 0));
  for (const minimum of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => classifyCJAvailability(stock, minimum), RangeError);
  }
});
