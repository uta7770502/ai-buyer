import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-risk.js';

function response(status, data) {
  return { ok: status === 200, status, headers: new Headers(), body: { cancel: async () => {} }, json: async () => data };
}

test('transient review HTTP 500 retries once and requires complete evidence', async t => {
  const previous = process.env.CJ_ACCESS_TOKEN;
  process.env.CJ_ACCESS_TOKEN = 'test-only';
  t.after(() => previous === undefined ? delete process.env.CJ_ACCESS_TOKEN : process.env.CJ_ACCESS_TOKEN = previous);
  let reviewCalls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/product/query')) return response(200, {result:true,data:{pid:'p1',comprehensiveScore:4.5}});
    if (!u.searchParams.has('score') && ++reviewCalls === 1) return response(500, {result:false});
    return response(200, {result:true,data:{total:100}});
  });
  const res = {setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
  await handler({method:'GET',query:{id:'p1'}},res);
  assert.equal(reviewCalls,2);
  assert.equal(res.code,200);
  assert.equal(res.body.risk.reviewCount,100);
});

test('persistent review HTTP 500 fails closed after one retry', async t => {
  const previous = process.env.CJ_ACCESS_TOKEN;
  process.env.CJ_ACCESS_TOKEN = 'test-only';
  t.after(() => previous === undefined ? delete process.env.CJ_ACCESS_TOKEN : process.env.CJ_ACCESS_TOKEN = previous);
  let calls = 0;
  t.mock.method(globalThis,'fetch',async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/product/query')) return response(200,{result:true,data:{pid:'p1',comprehensiveScore:4.5}});
    calls++;
    return response(500,{message:'private supplier error'});
  });
  const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
  await handler({method:'GET',query:{id:'p1'}},res);
  assert.equal(calls,2);
  assert.equal(res.code,502);
  assert.equal(res.body.code,'CJ_REVIEWS_UPSTREAM_REJECTED');
  assert.equal(res.body.upstreamStatus,500);
  assert.doesNotMatch(JSON.stringify(res.body),/private supplier error/);
});
