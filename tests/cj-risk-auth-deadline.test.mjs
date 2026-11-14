import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../lib/routes/cj-risk.js',import.meta.url),'utf8');

test('CJ review auth is included in a single ten-second budget',()=>{
  assert.match(source,/const deadline=Date\.now\(\)\+10000/);
  assert.match(source,/Promise\.race\(\[/);
  assert.match(source,/getCJAccessToken\(\)/);
  assert.match(source,/authTimer=setTimeout\(/);
  assert.match(source,/finally \{\s*clearTimeout\(authTimer\)/);
  assert.match(source,/const remaining=deadline-Date\.now\(\)/);
  assert.match(source,/AbortSignal\.timeout\(remaining\)/);
  assert.ok(source.indexOf('getCJAccessToken()') < source.indexOf('const detail=await getJson('));
  assert.doesNotMatch(source,/headers=\{'CJ-Access-Token':await getCJAccessToken\(\)\}/);
});

test('CJ review auth timeout fails closed and does not expose token',()=>{
  assert.match(source,/name:'TimeoutError'/);
  assert.match(source,/CJ_UPSTREAM_TIMEOUT/);
  assert.match(source,/Cache-Control','no-store'/);
  assert.doesNotMatch(source,/error:e\.message|token:token/);
});
