import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/routes/cj-detail.js',import.meta.url),'utf8');
test('CJ detail requests validate ids, bound timeouts and redact errors',()=>{
 assert.match(source,/Invalid product id/);
 assert.match(source,/AbortSignal\.timeout\(Math\.min\(remaining, CJ_DETAIL_TIMEOUT_MS\)\)/);
 assert.match(source,/await getCJAccessToken\(\)/);
 assert.match(source,/CJ_DETAIL_HTTP_ERROR/);
 assert.match(source,/\[500, 502, 503, 504\]/);
 assert.match(source,/deadline - Date\.now\(\)/);
 assert.match(source,/CJ_DETAIL_UPSTREAM_REJECTED/);
 assert.match(source,/CJ_DETAIL_ID_MISMATCH/);
 assert.match(source,/CJ_DETAIL_FETCH_FAILED/);
 assert.doesNotMatch(source,/error: error\.message/);
});

test('CJ detail retry releases failed responses and bounds backoff',()=>{
 assert.match(source,/await response\.body\?\.cancel\(\)\.catch\(\(\) => \{\}\)/);
 assert.match(source,/retryRemaining = deadline - Date\.now\(\)/);
 assert.match(source,/retryRemaining <= 150/);
 assert.match(source,/setTimeout\(resolve, 150\)/);
});

test('CJ detail HTTP errors never parse upstream response bodies',()=>{
 assert.match(source,/if \(!response\.ok\) \{[\s\S]*?response\.body\?\.cancel\(\)\.catch/);
 assert.match(source,/CJ_DETAIL_AUTH_REJECTED/);
 assert.match(source,/CJ_DETAIL_HTTP_ERROR/);
 assert.match(source,/const json = await response\.json\(\)\.catch/);
 assert.ok(source.indexOf('if (!response.ok) {') < source.indexOf('const json = await response.json()'));
});

test('CJ detail handles body cancellation failures without bypassing retry classification',()=>{
 assert.match(source,/await response\.body\?\.cancel\(\)\.catch\(\(\) => \{\}\)/);
 assert.match(source,/if \(!response\.ok\)/);
});
