import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/routes/cj-risk.js', import.meta.url), 'utf8');

test('CJ review HTTP errors are rejected before JSON body parsing', () => {
  const rejectAt = source.indexOf('if (!r.ok) {');
  const parseAt = source.indexOf('let j;');
  assert.ok(rejectAt >= 0 && parseAt > rejectAt);
  assert.match(source.slice(rejectAt, parseAt), /await r\.body\?\.cancel\(\)\.catch/);
  assert.match(source.slice(rejectAt, parseAt), /error\.upstreamStatus = r\.status/);
  assert.match(source.slice(rejectAt, parseAt), /throw error/);
});

test('CJ review failures retain stage diagnostics without leaking upstream bodies', () => {
  assert.match(source, /error\.stage = stage/);
  assert.match(source, /upstreamStatus:Number\.isInteger\(e\?\.upstreamStatus\)/);
  assert.doesNotMatch(source, /error:\s*e\?\.message|error:\s*message/);
});

test('CJ review retry cleanup failure cannot suppress HTTP retry classification', () => {
  const retryBlock = source.slice(source.indexOf('if ([500, 502, 503, 504].includes(r.status))'), source.indexOf('if (r.status === 429 && !retried)'));
  const throttleBlock = source.slice(source.indexOf('if (r.status === 429 && !retried)'), source.indexOf('// Do not parse upstream error bodies'));
  assert.match(retryBlock, /await r\.body\?\.cancel\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(throttleBlock, /await r\.body\?\.cancel\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(retryBlock, /await delay\(150/);
  assert.match(throttleBlock, /await delay\(waitMs/);
});

test('CJ review eligibility responses are never cached', () => {
  assert.match(source, /res\.setHeader\('Cache-Control','no-store'\)/);
  assert.doesNotMatch(source, /private, max-age=300/);
});

test('CJ review does not perform a third request after gateway retry followed by 429', () => {
  assert.match(source, /let retried = false;/);
  assert.match(source, /retried = true;/);
  assert.match(source, /if \(r\.status === 429 && !retried\)/);
});

test('CJ failure responses expose only an allowlisted diagnostic stage', () => {
  assert.match(source, /stage:\['auth','detail','reviews','review-score'\]\.includes\(e\?\.stage\)\?e\.stage:null/);
  assert.doesNotMatch(source, /stage:e\?\.stage[,}]/);
});

test('CJ evidence mismatches retain safe, specific diagnostic stages', () => {
  assert.match(source, /new Error\('CJ product identity mismatch'\), \{stage:'detail'\}/);
  assert.match(source, /new Error\('CJ review score count unavailable'\), \{stage:'review-score',reviewScore:score,diagnosticReason:'cj_review_score_total_invalid'\}/);
  assert.match(source, /new Error\('CJ review totals inconsistent'\), \{stage:'reviews',diagnosticReason:'cj_review_totals_invalid'\}/);
  assert.match(source, /stage:\['auth','detail','reviews','review-score'\]\.includes\(e\?\.stage\)/);
});


test('CJ malformed JSON and response-body timeout retain safe stage diagnostics', () => {
  assert.match(source, /catch \(cause\) \{/);
  assert.match(source, /signal\?\.aborted \|\| cause\?\.name === 'AbortError'/);
  assert.match(source, /name: 'TimeoutError', stage/);
  assert.match(source, /stage, diagnosticReason: 'cj_response_json_invalid'/);
  assert.doesNotMatch(source, /r\.json\(\)\.catch\(\(\)=>null\)/);
});


test('CJ fetch rejection retains the exact review stage and timeout classification', () => {
  assert.match(source, /async function fetchAtStage\(\)/);
  assert.match(source, /error\.stage = stage/);
  assert.match(source, /signal\?\.aborted \|\| cause\?\.name === 'AbortError'/);
  assert.match(source, /let r=await fetchAtStage\(\)/);
  assert.match(source, /r = await fetchAtStage\(\)/);
  assert.doesNotMatch(source, /r = await fetch\(url, \{headers, signal\}\)/);
});
