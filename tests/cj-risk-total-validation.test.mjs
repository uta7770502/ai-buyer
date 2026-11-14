import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRisk } from '../lib/routes/cj-risk.js';

test('invalid total review evidence fails closed before arithmetic', () => {
  for (const total of [undefined, null, NaN, Infinity, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1]) {
    const result = scoreRisk({ low: 0, mid: 0, total, rating: 4.9 });
    assert.equal(result.exclude, true, String(total));
    assert.equal(result.reason, 'review-counts-invalid', String(total));
  }
});

test('valid but insufficient review counts cannot authorize recommendation', () => {
  const result = scoreRisk({ low: 0, mid: 0, total: 9, rating: 5 });
  assert.equal(result.exclude, true);
  assert.equal(result.reason, 'review-evidence-insufficient');
});

test('ten valid positive reviews can pass the isolated review-risk gate', () => {
  const result = scoreRisk({ low: 0, mid: 0, total: 10, rating: 4.5 });
  assert.equal(result.exclude, false);
});
