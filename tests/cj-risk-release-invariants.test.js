import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRisk } from '../lib/routes/cj-risk.js';

// Release safety invariant: missing or contradictory review evidence cannot
// authorize a recommendation, regardless of the rating supplied by CJ.
test('review evidence is fail-closed for invalid counts and ratings', () => {
  const invalid = [
    { low: 0, mid: 0, total: 9, rating: 5 },
    { low: 0, mid: 0, total: 10, rating: 0 },
    { low: 0, mid: 0, total: 10, rating: NaN },
    { low: 0, mid: 0, total: 10, rating: Infinity },
    { low: 0, mid: 0, total: 10, rating: 5.1 },
    { low: -1, mid: 0, total: 10, rating: 5 },
    { low: 0, mid: -1, total: 10, rating: 5 },
    { low: 8, mid: 3, total: 10, rating: 5 },
    { low: 0.5, mid: 0, total: 10, rating: 5 },
    { low: 0, mid: 0, total: Number.MAX_SAFE_INTEGER + 1, rating: 5 },
  ];
  for (const input of invalid) {
    const risk = scoreRisk(input);
    assert.equal(risk.exclude, true, JSON.stringify(input));
    assert.notEqual(risk.level, 'low', JSON.stringify(input));
  }
});

test('rating below four and adverse review boundaries remain excluded', () => {
  for (const input of [
    { low: 0, mid: 0, total: 100, rating: 3.99 },
    { low: 3, mid: 0, total: 100, rating: 4.9 },
    { low: 0, mid: 8, total: 100, rating: 4.9 },
    { low: 0, mid: 5, total: 100, rating: 4.9 },
  ]) {
    assert.equal(scoreRisk(input).exclude, true, JSON.stringify(input));
  }
});

test('valid evidence permits only a genuinely low-risk case', () => {
  assert.deepEqual(
    { exclude: scoreRisk({ low: 0, mid: 0, total: 100, rating: 4.5 }).exclude,
      level: scoreRisk({ low: 0, mid: 0, total: 100, rating: 4.5 }).level },
    { exclude: false, level: 'low' }
  );
});
