import test from 'node:test';
import assert from 'node:assert/strict';
import { getCJAccessToken } from '../lib/cj-access-token.js';

test('overlapping callers share a token refresh and a failed refresh can be retried', async t => {
  const oldKey = process.env.CJ_API_KEY;
  process.env.CJ_API_KEY = 'test-key';
  t.after(() => {
    if (oldKey === undefined) delete process.env.CJ_API_KEY;
    else process.env.CJ_API_KEY = oldKey;
  });
  let rejectRefresh = true;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => rejectRefresh
    ? { ok: false, status: 429, json: async () => ({ message: 'private message' }) }
    : { ok: true, status: 200, json: async () => ({ result: true, data: { accessToken: 'new-token' } }) });

  const failed = await Promise.allSettled([getCJAccessToken(), getCJAccessToken()]);
  assert.equal(fetchMock.mock.callCount(), 1);
  for (const result of failed) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.upstreamStatus, 429);
    assert.equal(result.reason.message, 'CJ authentication failed');
  }
  rejectRefresh = false;
  assert.deepEqual(await Promise.all([getCJAccessToken(), getCJAccessToken()]), ['new-token', 'new-token']);
  assert.equal(await getCJAccessToken(), 'new-token');
  assert.equal(fetchMock.mock.callCount(), 2);
});
