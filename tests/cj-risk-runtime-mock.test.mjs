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
  const getJson = runInNewContext(implementation + '\ngetJson;', {
    fetch, delay: wait, Date, Number, Error, Object,
  });
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
  const h = harness([response(401), response(200)]);
  await assert.rejects(h.getJson(url, headers, undefined, 'reviews'), (e) =>
    e.stage === 'reviews' && e.upstreamStatus === 401);
  assert.equal(h.calls(), 1);
});

test('CJ gateway retry then rate-limit cannot trigger a third request', async () => {
  const h = harness([response(502), response(429), response(200)]);
  await assert.rejects(h.getJson(url, headers, undefined, 'review-score'), (e) =>
    e.stage === 'review-score' && e.upstreamStatus === 429);
  assert.equal(h.calls(), 2);
});

test('CJ invalid JSON envelope remains fail-closed with diagnostic stage', async () => {
  const h = harness([response(200, { result: false, data: { total: 12 } })]);
  await assert.rejects(h.getJson(url, headers, undefined, 'reviews'), (e) =>
    e.stage === 'reviews' && e.diagnosticReason === 'cj_response_envelope_unrecognized');
  assert.equal(h.calls(), 1);
});

test('CJ retry deadline preserves stage without issuing another request', async () => {
  const timeout = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const h = harness([response(502), response(200)], async () => { throw timeout; });
  await assert.rejects(h.getJson(url, headers, undefined, 'detail'), (e) =>
    e.name === 'TimeoutError' && e.stage === 'detail');
  assert.equal(h.calls(), 1);
});

test('CJ 429 with short Retry-After retries once and accepts verified JSON', async () => {
  const rateLimited = response(429);
  rateLimited.headers.get = (key) => key.toLowerCase() === 'retry-after' ? '1' : null;
  const waits = [];
  const h = harness([rateLimited, response(200)], async (ms) => { waits.push(ms); });
  const result = await h.getJson(url, headers, undefined, 'reviews');
  assert.equal(result.total, 12);
  assert.equal(h.calls(), 2);
  assert.deepEqual(waits, [1000]);
});

test('CJ non-JSON content type is rejected without parsing response body', async () => {
  const r = response(200);
  r.headers.get = () => 'text/html';
  r.json = async () => { throw new Error('must not parse HTML'); };
  const h = harness([r]);
  await assert.rejects(h.getJson(url, headers, undefined, 'detail'), (e) =>
    e.stage === 'detail' && e.diagnosticReason === 'cj_response_media_type_invalid');
  assert.equal(h.calls(), 1);
});

test('CJ malformed JSON retains the review stage and fails closed', async () => {
  const r = response(200);
  r.json = async () => { throw new SyntaxError('invalid JSON'); };
  const h = harness([r]);
  await assert.rejects(h.getJson(url, headers, undefined, 'reviews'), (e) =>
    e.stage === 'reviews' && e.diagnosticReason === 'cj_response_json_invalid');
  assert.equal(h.calls(), 1);
});


test('CJ fetch rejection preserves stage without exposing upstream exception text', async () => {
  const h = harness([new Error('private upstream diagnostic')]);
  await assert.rejects(h.getJson(url, headers, undefined, 'review-score'), (e) =>
    e.stage === 'review-score' && e.name === 'CJFetchError' && !e.message.includes('private'));
  assert.equal(h.calls(), 1);
});

test('CJ aborted response body is classified as timeout at its review stage', async () => {
  const r = response(200);
  r.json = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  const h = harness([r]);
  await assert.rejects(h.getJson(url, headers, undefined, 'reviews'), (e) =>
    e.stage === 'reviews' && e.name === 'TimeoutError');
  assert.equal(h.calls(), 1);
});

test('CJ second gateway failure is not retried indefinitely', async () => {
  const h = harness([response(503), response(502), response(200)]);
  await assert.rejects(h.getJson(url, headers, undefined, 'reviews'), (e) =>
    e.stage === 'reviews' && e.upstreamStatus === 502);
  assert.equal(h.calls(), 2);
});

test('CJ 429 Retry-After above bounded retry window fails closed without waiting', async () => {
  const rateLimited = response(429);
  rateLimited.headers.get = (key) => key.toLowerCase() === 'retry-after' ? '120' : null;
  const waits = [];
  const h = harness([rateLimited, response(200)], async (ms) => { waits.push(ms); });
  await assert.rejects(h.getJson(url, headers, undefined, 'reviews'), (e) =>
    e.stage === 'reviews' && e.upstreamStatus === 429);
  assert.equal(h.calls(), 1);
  assert.deepEqual(waits, []);
});

test('CJ review success envelope cannot be substituted for product detail identity evidence', async () => {
  const h = harness([response(200, { success: true, code: 0, data: { pid: 'example' } })]);
  await assert.rejects(h.getJson(url, headers, undefined, 'detail'), (e) =>
    e.stage === 'detail' && e.diagnosticReason === 'cj_response_envelope_unrecognized');
  assert.equal(h.calls(), 1);
});

// Keep independent low-star lookups concurrent: serial requests can exhaust the
// shared 10-second deadline before the final evidence gate is evaluated.
test('CJ one-star and two-star evidence requests share the same deadline concurrently', () => {
  assert.match(source, /Promise\.allSettled\(\[countByScore\(1\),\s*countByScore\(2\)\]\)/);
  assert.match(source, /scoreResults\.find\(result => result\.status === 'rejected'\)/);
  assert.match(source, /score1\s*\+\s*score2\s*>\s*total/);
});
