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
});

test('CJ review failures retain safe diagnostics without leaking upstream bodies', () => {
  assert.match(source, /const safeUpstreamStatus=Number\.isInteger\(e\?\.upstreamStatus\)\?e\.upstreamStatus:null/);
  assert.match(source, /const safeStage=\['auth','detail','reviews','review-score'\]\.includes\(e\?\.stage\)\?e\.stage:null/);
  assert.doesNotMatch(source, /error:\s*e\?\.message|error:\s*message/);
});

test('CJ review retry cleanup failure cannot suppress HTTP retry classification', () => {
  const retryBlock = source.slice(source.indexOf('if ([500, 502, 503, 504].includes(r.status))'), source.indexOf('if (r.status === 429 && !retried)'));
  const throttleBlock = source.slice(source.indexOf('if (r.status === 429 && !retried)'), source.indexOf('// Do not parse upstream error bodies'));
  assert.match(retryBlock, /await r\.body\?\.cancel\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(throttleBlock, /await r\.body\?\.cancel\(\)\.catch\(\(\) => \{\}\)/);
});

test('CJ review eligibility responses are never cached', () => {
  assert.match(source, /res\.setHeader\('Cache-Control','no-store'\)/);
});

test('CJ product identity mismatch keeps detail stage', () => {
  assert.match(source, /new Error\('CJ product identity mismatch'\), \{stage:'detail'\}/);
});

test('CJ live review evidence is derived from returned item scores', () => {
  assert.doesNotMatch(source, /reviewUrl\.searchParams\.set\('pageSize'/);
  assert.match(source, /Array\.isArray\(first\?\.list\)/);
  assert.match(source, /review\?\.score/);
  assert.match(source, /if\(score===1\)score1\+\+/);
  assert.match(source, /else if\(score===2\)score2\+\+/);
});

test('incomplete or malformed review pages fail closed', () => {
  assert.match(source, /CJ review page incomplete/);
  assert.match(source, /cj_review_page_incomplete/);
  assert.match(source, /CJ review item score invalid/);
  assert.match(source, /cj_review_item_score_invalid/);
});

test('CJ malformed JSON and response-body timeout retain safe stage diagnostics', () => {
  assert.match(source, /stage, diagnosticReason: 'cj_response_json_invalid'/);
  assert.doesNotMatch(source, /r\.json\(\)\.catch\(\(\)=>null\)/);
});
