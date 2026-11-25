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
const serverMarginApprovals = new Map();
const context = { oddlyMarginOverrides: overrides, serverMarginApprovals };
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);
const eligible = context.verifiedMarginRecommendation;
const product = (margin, extras = {}) => ({
  id: 'test-1',
  verifiedVariantId: '1234567890123',
  contributionMarginVerified: true,
  verifiedContributionMarginPercent: margin,
  finalProfitVerified: true,
  finalProfitJpy: 100,
  ...extras
});
test('default recommendation requires at least 25% verified margin', () => {
  assert.equal(eligible(product(25)), true);
  assert.equal(eligible(product(24.99)), false);
});
test('standard 25% and per-product 20% exception are respected', () => {
  overrides['test-1'] = 25;
  assert.equal(eligible(product(25)), true);
  assert.equal(eligible(product(24.99)), false);
  overrides['test-1'] = 20;
  assert.equal(eligible(product(20)), false);
  assert.equal(eligible(product(25)), true);
  const vid='1234567890123';
  const approval={approved:true,source:'product-specific-owner-approval',vid,threshold:20,approvedAt:new Date().toISOString(),approvalId:'approval-test-123'};
  serverMarginApprovals.set(vid,approval);
  assert.equal(eligible(product(20)), true);
  assert.equal(eligible(product(20,{verifiedVariantId:'1234567890124'})), false);
  for(const patch of [{threshold:25},{vid:'1234567890124'},{approved:false},{approvalId:''},{approvedAt:new Date(Date.now()-31*86400000).toISOString()}]){serverMarginApprovals.set(vid,{...approval,...patch});assert.equal(eligible(product(20)),false);}
  serverMarginApprovals.set(vid,approval);
  assert.equal(eligible(product(19.99)), false);
  serverMarginApprovals.clear();
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
  for (const invalid of [10, 19, 24, 31, 'invalid']) {
    overrides['test-1'] = invalid;
    assert.equal(eligible(product(35)), false, String(invalid));
  }
  delete overrides['test-1'];
});

test('selecting a 20 percent preference reads an existing approval, never creates it',()=>{const a=html.indexOf('function setProductMarginThreshold('),b=html.indexOf('function orderedRecommendedProducts()',a);const block=html.slice(a,b);assert.match(block,/\/api\/cj\?action=margin-exception&vid=/);assert.match(block,/Authorization:'Bearer '\+key/);assert.doesNotMatch(block,/method:\s*['"]POST/);});
