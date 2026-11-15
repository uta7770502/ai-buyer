import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCJStockResponse, classifyCJAvailability } from '../lib/cj-stock-validation.js';

const row = (cj, factory) => ({ cjInventoryNum: cj, factoryInventoryNum: factory, totalInventoryNum: cj + factory });
const response = (...data) => ({ result: true, data });

test('CJ warehouse exactly five units qualifies without factory replenishment', () => {
  const stock = validateCJStockResponse(response(row(5, 0)));
  assert.equal(stock.ok, true);
  assert.deepEqual(classifyCJAvailability(stock), {
    recommendationEligible: true, shopifyAvailable: 5,
    requiresFactoryReplenishment: false, reason: 'cj-warehouse'
  });
});

test('factory inventory can qualify as replenishment but never becomes Shopify available inventory', () => {
  const stock = validateCJStockResponse(response(row(2, 3)));
  assert.equal(stock.ok, true);
  const classified = classifyCJAvailability(stock);
  assert.equal(classified.recommendationEligible, true);
  assert.equal(classified.requiresFactoryReplenishment, true);
  assert.equal(classified.shopifyAvailable, 2);
});

test('factory-only inventory remains zero immediately available units', () => {
  const stock = validateCJStockResponse(response(row(0, 5)));
  assert.equal(classifyCJAvailability(stock).shopifyAvailable, 0);
  assert.equal(classifyCJAvailability(stock).requiresFactoryReplenishment, true);
});

test('incomplete factory stock cannot pass minimum threshold', () => {
  const stock = validateCJStockResponse(response(row(2, 2)));
  assert.equal(classifyCJAvailability(stock).recommendationEligible, false);
});

test('warehouse totals exceeding safe integer range fail closed', () => {
  const stock = validateCJStockResponse(response(row(Number.MAX_SAFE_INTEGER, 0), row(1, 0)));
  assert.equal(stock.ok, false);
  assert.equal(classifyCJAvailability(stock).recommendationEligible, false);
});

test('factory totals exceeding safe integer range fail closed', () => {
  const stock = validateCJStockResponse(response(row(0, Number.MAX_SAFE_INTEGER), row(0, 1)));
  assert.equal(stock.ok, false);
  assert.equal(classifyCJAvailability(stock).shopifyAvailable, null);
});

test('mismatched total inventory fails closed', () => {
  const stock = validateCJStockResponse(response({ cjInventoryNum: 4, factoryInventoryNum: 2, totalInventoryNum: 7 }));
  assert.equal(stock.ok, false);
});

test('missing or malformed inventory fails closed', () => {
  for (const value of [undefined, null, '', '-1', '1.5', '1e3', '01']) {
    const stock = validateCJStockResponse(response({ cjInventoryNum: value, factoryInventoryNum: 0, totalInventoryNum: 0 }));
    assert.equal(stock.ok, false, `unexpected acceptance: ${String(value)}`);
  }
});
