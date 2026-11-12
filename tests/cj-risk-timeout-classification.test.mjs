import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/routes/cj-risk.js', import.meta.url), 'utf8');
const classification = source.slice(source.indexOf('const kind='), source.indexOf('const status=', source.indexOf('const kind=')));

test('CJ timeout classification takes precedence over stage errors', () => {
  const timeout = classification.indexOf("?'CJ_UPSTREAM_TIMEOUT'");
  const detail = classification.indexOf("?'CJ_DETAIL_UPSTREAM_REJECTED'");
  const reviews = classification.indexOf("?'CJ_REVIEWS_UPSTREAM_REJECTED'");
  assert.ok(timeout >= 0 && detail > timeout && reviews > timeout);
});

test('CJ upstream auth rejection still takes precedence over timeout', () => {
  assert.ok(classification.indexOf("?'CJ_AUTH_REJECTED'") < classification.indexOf("?'CJ_UPSTREAM_TIMEOUT'"));
});
