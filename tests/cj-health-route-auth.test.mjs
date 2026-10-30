import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../api/cj.js',import.meta.url),'utf8');
test('CJ health probe requires admin authorization',()=>{
 assert.match(source,/'health':async\(req,res\)=>/);
 assert.match(source,/AI_BUYER_ADMIN_KEY/);
 assert.match(source,/timingSafeEqual/);
 assert.match(source,/status\(401\)/);
 assert.match(source,/return cjHealth\(req,res\)/);
});
