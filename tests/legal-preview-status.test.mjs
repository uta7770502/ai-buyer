import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../lib/routes/shopify-legal-preview.js',import.meta.url),'utf8');
test('legal preview is read-only and requires exact match before ready',()=>{
  assert.match(code,/ready:complete&&readiness\.ready&&comparison\?\.changed===false/);
  assert.match(code,/changedShopify:false,automaticPublish:false/);
  assert.doesNotMatch(code,/mutation\s+\w+\s*\{/);
});

test('legal preview requires admin authorization before loading stored data',()=>{
  const authCheck=code.indexOf("req.headers?.authorization!=='Bearer '+admin");
  const legalLoad=code.indexOf('await loadLegalConfig()');
  assert.ok(authCheck>=0&&legalLoad>authCheck);
});
test('legal preview refuses incomplete pagination and mismatched content',()=>{
  assert.match(code,/pages\.pageInfo\?\.hasNextPage===false/);
  assert.match(code,/legal_content_mismatch/);
  assert.match(code,/reason:'read_only_inspection_failed'/);
});
