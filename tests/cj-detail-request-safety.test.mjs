import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/routes/cj-detail.js',import.meta.url),'utf8');
test('CJ detail requests validate ids, bound timeouts and redact errors',()=>{
 assert.match(source,/Invalid product id/);
 assert.match(source,/AbortSignal\.timeout\(CJ_DETAIL_TIMEOUT_MS\)/);
 assert.match(source,/await getCJAccessToken\(\)/);
 assert.match(source,/CJ_DETAIL_HTTP_ERROR/);
 assert.match(source,/CJ_DETAIL_UPSTREAM_REJECTED/);
 assert.match(source,/CJ_DETAIL_ID_MISMATCH/);
 assert.match(source,/CJ_DETAIL_FETCH_FAILED/);
 assert.doesNotMatch(source,/error: error\.message/);
});
