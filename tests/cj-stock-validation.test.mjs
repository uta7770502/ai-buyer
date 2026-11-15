import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCJStockResponse as validate, classifyCJAvailability } from '../lib/cj-stock-validation.js';

const row = (cj, factory = 0, extra = {}) => ({ cjInventoryNum: cj, factoryInventoryNum: factory, totalInventoryNum: Number(cj) + Number(factory), ...extra });
const response = data => ({ result: true, data });

test('counts only CJ-managed inventory, not factory stock', () => {
  assert.deepEqual(validate(response([row(7, 100)])), { ok: true, total: 7, factoryTotal: 100, recommendationStockStatus: 'cj-stock' });
  assert.deepEqual(validate(response([row(0, 500)])), { ok: true, total: 0, factoryTotal: 500, recommendationStockStatus: 'factory-stock' });
  assert.deepEqual(validate(response([row(3, 2), row(4, 10)])), { ok: true, total: 7, factoryTotal: 12, recommendationStockStatus: 'cj-stock' });
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

test('both CJ and factory stock zero is out of stock', () => {
 assert.deepEqual(validate(response([row(0,0)])), {ok:true,total:0,factoryTotal:0,recommendationStockStatus:'out-of-stock'});
});

test('factory-only inventory can be recommended without overstating Shopify availability',()=>{
 const x=classifyCJAvailability(validate(response([row(0,12)])));
 assert.equal(x.recommendationEligible,true);
 assert.equal(x.shopifyAvailable,0);
 assert.equal(x.requiresFactoryReplenishment,true);
 assert.equal(x.reason,'factory-replenishment');
});
test('CJ warehouse threshold and factory shortage are kept distinct',()=>{
 assert.equal(classifyCJAvailability(validate(response([row(5,0)]))).recommendationEligible,true);
 assert.equal(classifyCJAvailability(validate(response([row(4,0)]))).recommendationEligible,false);
 assert.equal(classifyCJAvailability(validate(response([row(0,4)]))).recommendationEligible,false);
});
test('unverified CJ response cannot be used as a zero-stock confirmation',()=>{
 const x=classifyCJAvailability({ok:false,reason:'cj-rate-limited'});
 assert.equal(x.shopifyAvailable,null);
 assert.equal(x.recommendationEligible,false);
});

test('mixed CJ and factory stock reaches recommendation threshold without inflating Shopify stock',()=>{
 const x=classifyCJAvailability(validate(response([row(2,3)])));
 assert.equal(x.recommendationEligible,true);
 assert.equal(x.requiresFactoryReplenishment,true);
 assert.equal(x.shopifyAvailable,2);
 assert.equal(x.reason,'factory-replenishment');
 const y=classifyCJAvailability(validate(response([row(2,2)])));
 assert.equal(y.recommendationEligible,false);
 assert.equal(y.shopifyAvailable,2);
});
