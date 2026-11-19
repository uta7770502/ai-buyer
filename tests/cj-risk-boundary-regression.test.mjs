import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRisk } from '../lib/routes/cj-risk.js';

// Synthetic boundary cases only; never interpret as live CJ evidence.
const cases = [
  ['missing reviews', {low:0,mid:0,total:0,rating:5}, true, 'review-evidence-insufficient'],
  ['nine clean reviews', {low:0,mid:0,total:9,rating:5}, false, 'small-sample-clean'],
  ['nine reviews with one low rating', {low:1,mid:0,total:9,rating:4.8}, true, 'small-sample-low-review'],
  ['missing rating', {low:0,mid:0,total:10,rating:0}, true, 'review-evidence-insufficient'],
  ['rating below four', {low:0,mid:0,total:10,rating:3.99}, true, 'rating-below-four'],
  ['rating over five', {low:0,mid:0,total:10,rating:5.01}, true, 'rating-out-of-range'],
  ['negative review count', {low:-1,mid:0,total:10,rating:5}, true, 'review-counts-invalid'],
  ['fractional review count', {low:0.5,mid:0,total:10,rating:5}, true, 'review-counts-invalid'],
  ['review total mismatch', {low:7,mid:4,total:10,rating:5}, true, 'review-counts-invalid'],
  ['three low reviews', {low:3,mid:0,total:100,rating:5}, true, 'aftercare-risk-mid'],
  ['eight percent poor reviews', {low:0,mid:8,total:100,rating:5}, true, 'aftercare-risk-mid'],
  ['five percent poor reviews', {low:0,mid:5,total:100,rating:5}, true, 'low-review-rate-mid'],
  ['high risk low reviews', {low:8,mid:4,total:100,rating:5}, true, 'low-review-rate-high'],
  ['clean boundary', {low:0,mid:0,total:10,rating:4}, false, 'aftercare-risk-low'],
  ['clean larger sample', {low:1,mid:0,total:100,rating:4.8}, false, 'aftercare-risk-low'],
];
for (const [name,input,exclude,reason] of cases) {
  test('CJ risk fail-closed: '+name, () => {
    const actual = scoreRisk(input);
    assert.equal(actual.exclude,exclude);
    assert.equal(actual.reason,reason);
  });
}
