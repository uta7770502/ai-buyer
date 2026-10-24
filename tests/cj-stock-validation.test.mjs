import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCJStockResponse as validate } from '../lib/cj-stock-validation.js';

const row = (stock, extra = {}) => ({ verifiedWarehouse: 1, totalInventoryNum: stock, ...extra });
const response = data => ({ result: true, data });

test('accepts confirmed positive inventory and confirmed zero', () => {
  assert.deepEqual(validate(response([row(7)])), { ok: true, total: 7 });
  assert.deepEqual(validate(response([row(0)])), { ok: true, total: 0 });
});
test('rejects missing, empty, malformed and unverified inventory', () => {
  for (const data of [[], [row(undefined)], [row('')], [row('unknown')], [row(-1)], [row(2.5)], [row(2,{verifiedWarehouse:0})]]) {
    assert.equal(validate(response(data)).ok, false);
  }
  assert.equal(validate({result:false,data:[row(4)]}).ok,false);
});
test('rejects unsafe total overflow', () => {
  assert.equal(validate(response([row(Number.MAX_SAFE_INTEGER),row(1)])).ok,false);
});
