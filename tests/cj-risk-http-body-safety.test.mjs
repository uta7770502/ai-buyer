import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/routes/cj-risk.js', import.meta.url), 'utf8');

test('CJ review HTTP errors are rejected before JSON body parsing', () => {
  const rejectAt = source.indexOf('if (!r.ok) {');
  const parseAt = source.indexOf('const j=await r.json().catch(()=>null);');
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
  const retryBlock = source.slice(source.indexOf('if ([500, 502, 503, 504].includes(r.status))'), source.indexOf('if (r.status === 429)'));
  const throttleBlock = source.slice(source.indexOf('if (r.status === 429)'), source.indexOf('// Do not parse upstream error bodies'));
  assert.match(retryBlock, /await r\.body\?\.cancel\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(throttleBlock, /await r\.body\?\.cancel\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(retryBlock, /await delay\(150/);
  assert.match(throttleBlock, /await delay\(waitMs/);
});
