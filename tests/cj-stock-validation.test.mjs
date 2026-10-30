import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCJStockResponse as validate } from '../lib/cj-stock-validation.js';

const row = (cj, factory = 0, extra = {}) => ({ cjInventoryNum: cj, factoryInventoryNum: factory, totalInventoryNum: Number(cj) + Number(factory), ...extra });
const response = data => ({ result: true, data });

test('counts only CJ-managed inventory, not factory stock', () => {
  assert.deepEqual(validate(response([row(7, 100)])), { ok: true, total: 7 });
  assert.deepEqual(validate(response([row(0, 500)])), { ok: true, total: 0 });
  assert.deepEqual(validate(response([row(3, 2), row(4, 10)])), { ok: true, total: 7 });
});
test('rejects malformed, missing, inconsistent, or ambiguous inventory', () => {
  for (const data of [
    [], [null], [row(2, 0, {cjInventoryNum: undefined})],
    [row(2, 0, {factoryInventoryNum: undefined})],
    [row(2, 0, {totalInventoryNum: undefined})],
    [row(2, 0, {totalInventoryNum: 9})],
    [row(-1, 2)], [row(2.5, 0)], [row('unknown', 0)],
    [row(2, 0, {cjInventoryNum: ''})],
    [row(2, 0, {cjInventoryNum: '1e3'})]
  ]) assert.equal(validate(response(data)).ok, false);
  assert.equal(validate({ result: false, data: [row(4)] }).ok, false);
});
test('rejects overflow across warehouses', () => {
  assert.equal(validate(response([row(Number.MAX_SAFE_INTEGER), row(1)])).ok, false);
});
