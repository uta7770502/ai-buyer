'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifiedAuthorizedMargin } = require('../lib/verified-authorized-margin.cjs');
const base = {sku:'ODDLY-001',salePriceJpy:10000,productCostJpy:5000,
  shippingJpy:1000,paymentFeeJpy:300,platformFeeJpy:200,
  plannedAdCostJpy:500,returnReserveJpy:500,
  costSourceVerified:true,jpShippingVerified:true,feesVerified:true};
const approval = {approved:true,sku:'ODDLY-001',threshold:25,
  approvedBy:'operator',approvedAt:'2026-10-01T00:00:00.000Z'};
test('standard margin needs no exception approval', () => {
  assert.deepEqual(verifiedAuthorizedMargin({...base,productCostJpy:4500},null),
    {allowed:true,threshold:30,reason:'standard_margin_met'});
});
test('25% and 20% require explicit SKU-scoped approval', () => {
  assert.equal(verifiedAuthorizedMargin(base,approval).allowed,true);
  assert.equal(verifiedAuthorizedMargin({...base,productCostJpy:5500},
    {...approval,threshold:20}).allowed,true);
  assert.equal(verifiedAuthorizedMargin({...base,productCostJpy:5500},approval).allowed,false);
});
test('missing, forged, unrelated or future approvals fail closed', () => {
  const invalid = [null,{}, {...approval,approved:'true'}, {...approval,approved:false},
    {...approval,sku:'OTHER'}, {...approval,threshold:30}, {...approval,threshold:'25'},
    {...approval,approvedBy:''}, {...approval,approvedAt:'bad'},
    {...approval,approvedAt:'2999-01-01T00:00:00Z'}];
  for (const a of invalid) assert.equal(verifiedAuthorizedMargin(base,a).allowed,false);
});
test('approval cannot override missing evidence or invalid costs', () => {
  for (const patch of [{feesVerified:false},{jpShippingVerified:false},
    {costSourceVerified:false},{productCostJpy:-1}]) {
    assert.equal(verifiedAuthorizedMargin({...base,...patch},approval).allowed,false);
  }
});
