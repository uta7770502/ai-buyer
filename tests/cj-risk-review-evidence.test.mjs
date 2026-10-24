import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/routes/cj-risk.js',import.meta.url),'utf8');
test('CJ review API failures must not become zero-review success',()=>{
 assert.doesNotMatch(source,/getJson\(reviewUrl,headers\)\.catch\(/);
 assert.doesNotMatch(source,/getJson\(u,headers\)\.catch\(/);
});
test('missing review evidence blocks recommendation',()=>{
 assert.match(source,/total<=0\|\|!rated/);
 assert.match(source,/reason:'review-evidence-insufficient'/);
 assert.match(source,/exclude:true/);
});
