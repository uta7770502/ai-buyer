import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-risk.js';

function invoke(query, method = 'GET') {
  const headers = {};
  let statusCode = 200;
  let payload;
  const res = {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(value) { statusCode = value; return this; },
    json(value) { payload = value; return this; }
  };
  return handler({ method, query }, res).then(() => ({ statusCode, payload, headers }));
}

test('CJ risk rejects ambiguous and malformed identifiers before upstream access', async (t) => {
  for (const id of [undefined, null, ['pid'], { id: 'pid' }, ' pid', 'pid ', '', 'pid?x=1', 'x'.repeat(101)]) {
    await t.test(String(id), async () => {
      const result = await invoke({ id });
      assert.equal(result.statusCode, 400);
      assert.equal(result.payload.ok, false);
      assert.equal(result.headers['cache-control'], 'no-store');
    });
  }
});

test('CJ risk rejects unsupported HTTP methods without caching', async () => {
  const result = await invoke({ id: 'pid' }, 'POST');
  assert.equal(result.statusCode, 405);
  assert.equal(result.headers['cache-control'], 'no-store');
});
