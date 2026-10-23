// Run with: node --test tests/safety-gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../api/shopify-publish.js',import.meta.url),'utf8');
function extractRegex(variable){
  const match=source.match(new RegExp('const '+variable+'=(\\/.*?\\/[a-z]*)\\.test\\(safetySource\\)'));
  assert.ok(match,'Missing '+variable+' expression');
  return Function('return '+match[1])();
}
test('blocked products include pesticide and electric shock collars',()=>{
  assert.match(source,/pesticide/);
  assert.match(source,/shock collar/);
  assert.match(source,/safetyBlocked:true/);
});
test('battery and pet food are flagged for review',()=>{
  const rule=extractRegex('safetyReview');
  assert.equal(rule.test('electric battery toy'),true);
  assert.equal(rule.test('pet food'),true);
  assert.equal(rule.test('電動おもちゃ'),true);
  assert.equal(rule.test('ordinary ceramic bowl'),false);
});
test('review data cannot be verified from browser input',()=>{
  assert.match(source,/const reviewsVerified=false;/);
  assert.match(source,/if\(!reviewsVerified\)safetyReasons\.push\('レビュー根拠が未確認'\)/);
  assert.match(source,/if\(p\.publishApproved===true&&!safetyReady\)/);
});
test('new Shopify products are drafts by default',()=>{
  assert.match(source,/vendor,status:'DRAFT',tags:productTags/);
});
