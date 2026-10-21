import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../lib/routes/shopify-legal-preview.js',import.meta.url),'utf8');
test('legal preview is read-only and requires exact match before ready',()=>{
  assert.match(code,/ready:complete&&readiness\.ready&&comparison\?\.changed===false/);
  assert.match(code,/changedShopify:false,automaticPublish:false/);
  assert.doesNotMatch(code,/mutation\s+\w+\s*\{/);
});
