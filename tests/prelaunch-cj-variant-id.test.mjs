import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('prelaunch product audit requires CJ numeric variant IDs compatible with stock sync',()=>{
  const audit=fs.readFileSync(new URL('../lib/routes/prelaunch-product-audit.js',import.meta.url),'utf8');
  const stock=fs.readFileSync(new URL('../lib/routes/cj-shopify-stock-sync.js',import.meta.url),'utf8');
  assert.match(audit,/\^\\d\{10,25\}\$/);
  assert.match(stock,/\^\\d\{10,25\}\$/);
  assert.match(audit,/CJバリエーションIDの形式が不正です/);
});
