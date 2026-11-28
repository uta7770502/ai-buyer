import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRisk } from '../lib/routes/cj-risk.js';

// Safety gate regression: only independently verified, low-risk reviews may pass.
// These fixtures are synthetic; they do not establish live CJ review evidence.
const baseline = { low: 0, mid: 0, total: 100, rating: 4.8 };

test('verified low-risk review evidence may pass', () => {
  assert.equal(scoreRisk(baseline).exclude, false);
});

for (const [name, changes] of [
  ['missing reviews', { total: 0 }],
  ['fewer than ten reviews', { total: 9 }],
  ['missing rating', { rating: 0 }],
  ['rating below four', { rating: 3.99 }],
  ['rating above five', { rating: 5.1 }],
  ['negative low count', { low: -1 }],
  ['fractional review count', { total: 10.5 }],
  ['review count exceeds total', { low: 60, mid: 50 }],
  ['moderate low-rating risk', { low: 3 }],
  ['high low-rating risk', { low: 12, mid: 1 }],
  ['combined low-rating ratio', { low: 1, mid: 7 }],
  ['minimum low-rating ratio', { low: 1, mid: 4 }]
]) {
  test('fail-closed: ' + name, () => {
    const result = scoreRisk({ ...baseline, ...changes });
    assert.equal(result.exclude, true, name);
    assert.notEqual(result.level, 'low', name);
  });
}
