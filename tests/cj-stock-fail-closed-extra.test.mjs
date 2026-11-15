import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCJStockResponse, classifyCJAvailability } from '../lib/cj-stock-validation.js';

const row = (cj, factory) => ({ cjInventoryNum: cj, factoryInventoryNum: factory, totalInventoryNum: cj + factory });
const verify = (...rows) => validateCJStockResponse({ result: true, data: rows });

test('five CJ units are immediately eligible', () => {
  const result = classifyCJAvailability(verify(row(5, 0)));
  assert.equal(result.recommendationEligible, true);
  assert.equal(result.shopifyAvailable, 5);
  assert.equal(result.requiresFactoryReplenishment, false);
});

test('four CJ units without factory replenishment are rejected', () => {
  const result = classifyCJAvailability(verify(row(4, 0)));
  assert.equal(result.recommendationEligible, false);
  assert.equal(result.shopifyAvailable, 4);
});

test('factory stock fills recommendation threshold but not sellable stock', () => {
  const result = classifyCJAvailability(verify(row(4, 1)));
  assert.equal(result.recommendationEligible, true);
  assert.equal(result.shopifyAvailable, 4);
  assert.equal(result.requiresFactoryReplenishment, true);
});

test('factory-only inventory is not immediately sellable', () => {
  const result = classifyCJAvailability(verify(row(0, 5)));
  assert.equal(result.recommendationEligible, true);
  assert.equal(result.shopifyAvailable, 0);
  assert.equal(result.requiresFactoryReplenishment, true);
});

test('factory shortage blocks recommendation', () => {
  const result = classifyCJAvailability(verify(row(0, 4)));
  assert.equal(result.recommendationEligible, false);
  assert.equal(result.shopifyAvailable, 0);
});

test('CJ warehouse quantities across rows are summed without factory quantities', () => {
  const result = classifyCJAvailability(verify(row(2, 100), row(3, 0)));
  assert.equal(result.shopifyAvailable, 5);
  assert.equal(result.requiresFactoryReplenishment, false);
});

test('inconsistent supplier totals fail closed', () => {
  const bad = { ...row(4, 1), totalInventoryNum: 6 };
  assert.equal(verify(bad).ok, false);
  assert.equal(classifyCJAvailability(verify(bad)).shopifyAvailable, null);
});

test('unsafe integer stock is rejected', () => {
  assert.equal(verify(row(Number.MAX_SAFE_INTEGER + 1, 0)).ok, false);
});

test('malformed warehouse row cannot authorize inventory', () => {
  const result = classifyCJAvailability(verify(row(5, 0), null));
  assert.equal(result.recommendationEligible, false);
  assert.equal(result.shopifyAvailable, null);
});

test('unverified input cannot authorize inventory', () => {
  assert.equal(classifyCJAvailability(null).recommendationEligible, false);
  assert.equal(classifyCJAvailability({ ok: false, total: 999, factoryTotal: 999 }).shopifyAvailable, null);
});
