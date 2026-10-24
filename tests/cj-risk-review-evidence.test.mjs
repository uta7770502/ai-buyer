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

test('invalid and inconsistent CJ review totals fail closed',()=>{
 assert.match(source,/CJ review score count unavailable/);
 assert.match(source,/CJ review totals inconsistent/);
 assert.match(source,/score1\+score2>total/);
});

test('risk scorer rejects internally inconsistent rating counts',()=>{
 assert.match(source,/reason:'review-counts-invalid'/);
 assert.match(source,/low\+mid>total/);
});

test('average CJ rating below 4.0 is excluded explicitly',()=>{
 assert.match(source,/rating<4\.0/);
 assert.match(source,/reason:'rating-below-four'/);
});

test('CJ ratings outside five-star scale are excluded',()=>{
 assert.match(source,/rating>5/);
 assert.match(source,/reason:'rating-out-of-range'/);
});
