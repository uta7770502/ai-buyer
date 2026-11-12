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
