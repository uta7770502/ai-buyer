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

test('invalid component counts and impossible totals always fail closed', () => {
  const invalid = [
    { low: -1, mid: 0, total: 10 },
    { low: 0, mid: -1, total: 10 },
    { low: 1.5, mid: 0, total: 10 },
    { low: 0, mid: NaN, total: 10 },
    { low: 8, mid: 3, total: 10 },
    { low: Number.MAX_SAFE_INTEGER, mid: 1, total: Number.MAX_SAFE_INTEGER },
  ];
  for (const counts of invalid) {
    const result = scoreRisk({ ...counts, rating: 4.9 });
    assert.equal(result.exclude, true, JSON.stringify(counts));
    assert.equal(result.reason, 'review-counts-invalid', JSON.stringify(counts));
  }
});

test('invalid rating evidence and below-four ratings never pass', () => {
  for (const rating of [undefined, null, NaN, Infinity, -1, 0, 5.1]) {
    assert.equal(scoreRisk({ low: 0, mid: 0, total: 20, rating }).exclude, true, String(rating));
  }
  const belowFour = scoreRisk({ low: 0, mid: 0, total: 20, rating: 3.99 });
  assert.equal(belowFour.exclude, true);
  assert.equal(belowFour.reason, 'rating-below-four');
});
