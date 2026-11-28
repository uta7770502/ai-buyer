import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCJStockResponse } from '../lib/cj-stock-validation.js';

const row = (cj, factory, total = cj + factory) => ({
  cjInventoryNum: cj, factoryInventoryNum: factory, totalInventoryNum: total,
});
const response = (...rows) => ({ result: true, data: rows });

test('CJ-managed stock is reported separately from factory stock', () => {
  assert.deepEqual(validateCJStockResponse(response(row(5, 7))), {
    ok: true, total: 5, factoryTotal: 7, recommendationStockStatus: 'cj-stock',
  });
});
test('factory-only stock is distinguishable from unavailable stock', () => {
  assert.equal(validateCJStockResponse(response(row(0, 6))).recommendationStockStatus, 'factory-stock');
  assert.equal(validateCJStockResponse(response(row(0, 0))).recommendationStockStatus, 'out-of-stock');
});
test('rejects missing, negative, fractional, unsafe and inconsistent quantities', () => {
  for (const candidate of [
    { cjInventoryNum: 5, factoryInventoryNum: 0 },
    row(-1, 0, -1),
    row('1.5', 0, '1.5'),
    row('9007199254740992', 0, '9007199254740992'),
    row(5, 1, 5),
  ]) assert.equal(validateCJStockResponse(response(candidate)).ok, false);
});
test('rejects empty and malformed warehouse records', () => {
  for (const candidate of [null, {}, { result: false, data: [row(5, 0)] }, response(), response(null)]) {
    assert.equal(validateCJStockResponse(candidate).ok, false);
  }
});
test('sums multiple warehouses without confusing factory and CJ stock', () => {
  const result = validateCJStockResponse(response(row(2, 3), row(4, 1)));
  assert.equal(result.ok, true);
  assert.equal(result.total, 6);
  assert.equal(result.factoryTotal, 4);
});
