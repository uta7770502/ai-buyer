import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('explicitly unverified pet suitability blocks prelaunch audit',()=>{
 const source=fs.readFileSync(new URL('../lib/routes/prelaunch-product-audit.js',import.meta.url),'utf8');
 const match=source.match(/if\(\/(.+)\/\.test\(description\)\)reasons\.push\('ペット向けの使用適性が未確認、または販売準備中です'\)/);
 assert.ok(match,'safety block must be enforced in product audit');
 const unsafe=new RegExp(match[1]);
 assert.equal(unsafe.test('犬・猫向けの使用適性は未確認のため、販売準備中です。'),true);
 assert.equal(unsafe.test('犬用のボールおもちゃ。使用後は保管してください。'),false);
});
