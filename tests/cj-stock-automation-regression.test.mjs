import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCJStockResponse, classifyCJAvailability } from '../lib/cj-stock-validation.js';

const row = (cj, factory) => ({ cjInventoryNum: cj, factoryInventoryNum: factory, totalInventoryNum: cj + factory });
const verified = (...rows) => validateCJStockResponse({ result: true, data: rows });

test('five CJ warehouse units are eligible without factory replenishment', () => {
  const result = classifyCJAvailability(verified(row(5, 0)));
  assert.deepEqual(result, { recommendationEligible: true, shopifyAvailable: 5, requiresFactoryReplenishment: false, reason: 'cj-warehouse' });
});

test('factory replenishment remains a candidate, never immediate Shopify stock', () => {
  const result = classifyCJAvailability(verified(row(2, 3)));
  assert.equal(result.recommendationEligible, true);
  assert.equal(result.shopifyAvailable, 2);
  assert.equal(result.requiresFactoryReplenishment, true);
  assert.equal(result.reason, 'factory-replenishment');
});

test('factory-only stock does not create immediate Shopify availability', () => {
  const result = classifyCJAvailability(verified(row(0, 5)));
  assert.equal(result.recommendationEligible, true);
  assert.equal(result.shopifyAvailable, 0);
  assert.equal(result.requiresFactoryReplenishment, true);
});

test('insufficient combined stock is excluded', () => {
  const result = classifyCJAvailability(verified(row(2, 2)));
  assert.equal(result.recommendationEligible, false);
  assert.equal(result.shopifyAvailable, 2);
});

test('no CJ or factory stock is excluded', () => {
  const result = classifyCJAvailability(verified(row(0, 0)));
  assert.equal(result.recommendationEligible, false);
  assert.equal(result.reason, 'insufficient-stock');
});

test('unverified and inconsistent upstream responses fail closed', () => {
  for (const stock of [
    validateCJStockResponse({ result: false, data: [row(10, 0)] }),
    validateCJStockResponse({ result: true, data: [{ ...row(5, 2), totalInventoryNum: 8 }] }),
    validateCJStockResponse({ result: true, data: [{ cjInventoryNum: '', factoryInventoryNum: 10, totalInventoryNum: 10 }] })
  ]) {
    assert.equal(stock.ok, false);
    const classified = classifyCJAvailability(stock);
    assert.equal(classified.recommendationEligible, false);
    assert.equal(classified.shopifyAvailable, null);
  }
});

test('factory inventory is never added to immediate Shopify quantity across warehouses', () => {
  const result = classifyCJAvailability(verified(row(1, 20), row(2, 30)));
  assert.equal(result.shopifyAvailable, 3);
  assert.equal(result.requiresFactoryReplenishment, true);
});
