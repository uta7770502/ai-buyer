import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('stock sync refuses apply when no draft products are found',()=>{
 const source=fs.readFileSync(new URL('../lib/routes/cj-shopify-stock-sync.js',import.meta.url),'utf8');
 const zero=source.indexOf('if(products.length===0)');
 const fail=source.indexOf("if(apply)return res.status(409)",zero);
 const success=source.indexOf('return res.status(200).json(',zero);
 assert.ok(zero>=0&&fail>zero&&success>fail,'apply must fail before empty dry-run success');
 assert.match(source.slice(fail,success),/NO_DRAFT_PRODUCTS/);
});
