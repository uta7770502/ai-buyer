import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../lib/routes/cj-risk.js', import.meta.url), 'utf8');
const implementation = source.slice(source.indexOf('async function getJson('), source.indexOf('function parseReviewCount('));

function response(status, data = { result: true, data: { total: 12 } }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (key) => key.toLowerCase() === 'content-type' ? 'application/json' : null },
    body: { cancel: async () => {} },
    json: async () => data,
  };
}
function harness(sequence, wait = async () => {}) {
  let calls = 0;
  const fetch = async () => {
    const next = sequence[calls++];
    if (next instanceof Error) throw next;
    return next;
  };
  const getJson = runInNewContext(implementation + '\ngetJson;', {fetch, delay: wait, Date, Number, Error, Object});
  return { getJson, calls: () => calls };
}
const url = 'https://example.invalid/reviews';
const headers = { 'CJ-Access-Token': 'mock' };

test('CJ 502 followed by valid JSON succeeds after exactly one retry', async () => {
  const h = harness([response(502), response(200)]);
  const result = await h.getJson(url, headers, undefined, 'reviews');
  assert.equal(result.total, 12);
  assert.equal(h.calls(), 2);
});

test('CJ authentication rejection never retries and keeps stage/status', async () => {
  const h = harness([response(401)]);
  await assert.rejects(h.getJson(url, headers, undefined, 'reviews'), e => e.stage === 'reviews' && e.upstreamStatus === 401);
  assert.equal(h.calls(), 1);
});

test('CJ gateway retry then rate-limit cannot trigger a third request', async () => {
  const h = harness([response(502), response(429), response(200)]);
  await assert.rejects(h.getJson(url, headers, undefined, 'reviews'), e => e.stage === 'reviews' && e.upstreamStatus === 429);
  assert.equal(h.calls(), 2);
});

test('CJ 429 with short Retry-After retries once', async () => {
  const limited=response(429);
  limited.headers.get=key=>key.toLowerCase()==='retry-after'?'1':null;
  const waits=[];
  const h=harness([limited,response(200)],async ms=>waits.push(ms));
  const result=await h.getJson(url,headers,undefined,'reviews');
  assert.equal(result.total,12);
  assert.deepEqual(waits,[1000]);
});

test('CJ non-JSON content type is rejected', async () => {
  const r=response(200);r.headers.get=()=> 'text/html';
  const h=harness([r]);
  await assert.rejects(h.getJson(url,headers,undefined,'reviews'),e=>e.diagnosticReason==='cj_response_media_type_invalid');
});

test('CJ malformed JSON retains review stage', async () => {
  const r=response(200);r.json=async()=>{throw new SyntaxError('invalid JSON')};
  const h=harness([r]);
  await assert.rejects(h.getJson(url,headers,undefined,'reviews'),e=>e.stage==='reviews'&&e.diagnosticReason==='cj_response_json_invalid');
});

test('CJ second gateway failure is not retried indefinitely', async () => {
  const h=harness([response(503),response(502),response(200)]);
  await assert.rejects(h.getJson(url,headers,undefined,'reviews'),e=>e.upstreamStatus===502);
  assert.equal(h.calls(),2);
});

test('risk handler no longer depends on score-filter concurrency',()=>{
  assert.doesNotMatch(source,/Promise\.allSettled\(\[countByScore/);
  assert.match(source,/pageSize','100'/);
  assert.match(source,/for\(const review of reviews\.slice\(0,total\)\)/);
});
