import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/routes/cj-risk.js', import.meta.url), 'utf8');
const getJson = source.slice(source.indexOf('async function getJson('), source.indexOf('function parseReviewCount('));

test('CJ retries 502 gateway failure along with other transient 5xx once', () => {
  assert.match(getJson, /\[500,\s*502,\s*503,\s*504\]\.includes\(r\.status\)/);
  assert.match(getJson, /await delay\(150, undefined, \{ signal \}\)/);
  assert.match(getJson, /try \{ return await fetch\(url, \{ headers, signal \}\); \}/);
  assert.match(getJson, /r = await fetchAtStage\(\)/);
});

test('CJ does not retry authentication failures or treat a failed retry as success', () => {
  assert.doesNotMatch(getJson, /\[.*401.*\]\.includes\(r\.status\)/);
  assert.doesNotMatch(getJson, /\[.*403.*\]\.includes\(r\.status\)/);
  assert.match(getJson, /if \(!r\.ok\) \{/);
  assert.match(getJson, /error\.upstreamStatus = r\.status/);
});


test('CJ review retries at most once across gateway and rate-limit responses', () => {
  assert.match(getJson, /let retried = false/);
  assert.match(getJson, /retried = true/);
  assert.match(getJson, /r\.status === 429 && !retried/);
  assert.match(getJson, /Number\.isFinite\(waitMs\) && waitMs >= 0 && waitMs <= 2000/);
});


test('CJ retry backoff timeout preserves failing stage for diagnostics', () => {
  assert.match(getJson, /catch \{ throw Object\.assign\(new Error\('CJ retry deadline exceeded'\), \{ name: 'TimeoutError', stage \}\); \}/);
  assert.match(getJson, /catch \{ throw Object\.assign\(new Error\('CJ rate-limit retry deadline exceeded'\), \{ name: 'TimeoutError', stage \}\); \}/);
});
