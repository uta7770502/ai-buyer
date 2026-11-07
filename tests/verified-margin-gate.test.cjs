// Run: node --test tests/verified-margin-gate.test.cjs
// Pure UI-gate regression tests; never calls CJ, Shopify, or production endpoints.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function verifiedMarginRecommendation(p){');
const end = html.indexOf('\nfunction setProductMarginThreshold(', start);
assert.ok(start >= 0 && end > start, 'Verified recommendation gate must exist in index.html');
const overrides = {};
const context = { oddlyMarginOverrides: overrides };
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);
const eligible = context.verifiedMarginRecommendation;
const product = (margin, extras = {}) => ({
  id: 'test-1',
  contributionMarginVerified: true,
  verifiedContributionMarginPercent: margin,
  finalProfitVerified: true,
  finalProfitJpy: 100,
  ...extras
});
test('default recommendation requires at least 30% verified margin', () => {
  assert.equal(eligible(product(30)), true);
  assert.equal(eligible(product(29.99)), false);
});
test('per-product 25% and 20% exceptions are respected', () => {
  overrides['test-1'] = 25;
  assert.equal(eligible(product(25)), true);
  assert.equal(eligible(product(24.99)), false);
  overrides['test-1'] = 20;
  assert.equal(eligible(product(20)), true);
  assert.equal(eligible(product(19.99)), false);
  delete overrides['test-1'];
});
test('unverified margin or final profit is never recommended', () => {
  for (const changes of [
    { contributionMarginVerified: false },
    { verifiedContributionMarginPercent: undefined },
    { finalProfitVerified: false },
    { finalProfitJpy: 0 },
    { finalProfitJpy: -1 },
    { finalProfitJpy: undefined }
  ]) assert.equal(eligible(product(35, changes)), false, JSON.stringify(changes));
});
test('invalid exceptions fail closed', () => {
  for (const invalid of [0, 10, 19, 24, 31, 'invalid']) {
    overrides['test-1'] = invalid;
    assert.equal(eligible(product(35)), false, String(invalid));
  }
  delete overrides['test-1'];
});
