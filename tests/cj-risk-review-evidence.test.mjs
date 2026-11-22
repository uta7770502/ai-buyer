import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scoreRisk} from '../lib/routes/cj-risk.js';

const source=readFileSync(new URL('../lib/routes/cj-risk.js',import.meta.url),'utf8');

test('CJ review API failures must not become zero-review success',()=>{
 assert.doesNotMatch(source,/getJson\(reviewUrl,headers\)\.catch\(/);
 assert.match(source,/CJ review list unavailable/);
 assert.match(source,/CJ review page incomplete/);
});

test('missing review evidence blocks recommendation',()=>{
 assert.match(source,/total<=0\|\|!rated/);
 assert.match(source,/reason:'review-evidence-insufficient'/);
 assert.match(source,/exclude:true/);
});

test('live low-star counts come from returned review item scores',()=>{
 assert.doesNotMatch(source,/reviewUrl\.searchParams\.set\('pageSize'/);
 assert.match(source,/const score=parseReviewCount\(review\?\.score\)/);
 assert.match(source,/score===1/);
 assert.match(source,/score===2/);
});

test('risk scorer rejects internally inconsistent rating counts',()=>{
 assert.equal(scoreRisk({low:8,mid:3,total:10,rating:4.9}).reason,'review-counts-invalid');
});

test('average CJ rating below 4.0 is excluded explicitly',()=>{
 assert.equal(scoreRisk({low:0,mid:0,total:10,rating:3.99}).reason,'rating-below-four');
});

test('CJ ratings outside five-star scale are excluded',()=>{
 assert.equal(scoreRisk({low:0,mid:0,total:10,rating:5.1}).reason,'rating-out-of-range');
});

test('live CJ review total cannot fall back to stale catalog comment count',()=>{
 assert.match(source,/const total=parseReviewCount\(first\?\.total\)/);
 assert.doesNotMatch(source,/all\?\.total\?\?detail\?\.commentCount/);
});

test('risk scorer fails closed for missing and inconsistent live review evidence',()=>{
 for(const args of [
  {low:0,mid:0,total:0,rating:4.9},
  {low:2,mid:1,total:2,rating:4.9},
  {low:-1,mid:0,total:20,rating:4.9},
  {low:0,mid:0,total:20,rating:NaN},
  {low:0,mid:0,total:20,rating:5.1},
  {low:0,mid:0,total:20,rating:3.99}
 ]) assert.equal(scoreRisk(args).exclude,true,JSON.stringify(args));
});

test('clean small samples may pass but any low-star review blocks them',()=>{
 assert.equal(scoreRisk({low:0,mid:0,total:3,rating:5}).exclude,false);
 assert.equal(scoreRisk({low:1,mid:0,total:3,rating:4.8}).exclude,true);
 assert.equal(scoreRisk({low:0,mid:1,total:9,rating:4.8}).exclude,true);
 assert.equal(scoreRisk({low:0,mid:0,total:10,rating:4.5}).exclude,false);
});
