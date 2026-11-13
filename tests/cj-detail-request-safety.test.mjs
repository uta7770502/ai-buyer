import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/routes/cj-detail.js',import.meta.url),'utf8');
test('CJ detail requests validate ids, bound timeouts and redact errors',()=>{
 assert.match(source,/Invalid product id/);
 assert.match(source,/AbortSignal\.timeout\(Math\.min\(remaining, CJ_DETAIL_TIMEOUT_MS\)\)/);
 assert.match(source,/Promise\.race\(\[getCJAccessToken\(\), new Promise/);
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
 assert.match(source,/await delay\(150, undefined, \{ signal: AbortSignal\.timeout\(Math\.max\(1, retryRemaining\)\) \}\)/);
 assert.doesNotMatch(source,/setTimeout\(resolve, 150\)/);
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

test('CJ detail malformed envelopes and mismatched ids fail closed without caching',()=>{
 assert.match(source,/if \(json\?\.result !== true\) \{/);
 assert.match(source,/code: !json \? 'CJ_DETAIL_INVALID_JSON' : 'CJ_DETAIL_UPSTREAM_REJECTED'/);
 assert.match(source,/if\(!p \|\| typeof p !== 'object'[\s\S]*?res\.setHeader\('Cache-Control', 'no-store'\);[\s\S]*?CJ_DETAIL_ID_MISMATCH/);
 assert.doesNotMatch(source,/const authRejected = false/);
});


test('CJ detail token refresh is covered by the total request deadline',()=>{
 assert.ok(source.indexOf('const deadline = Date.now() + CJ_DETAIL_TIMEOUT_MS') < source.indexOf('getCJAccessToken()'));
 assert.match(source,/Promise\.race\(\[getCJAccessToken\(\), new Promise/);
 assert.match(source,/CJ detail auth timeout/);
 assert.match(source,/name: 'TimeoutError'/);
});


test('CJ detail auth deadline applies before upstream fetch and prevents token exposure',()=>{
 assert.match(source,/const deadline = Date\.now\(\) \+ CJ_DETAIL_TIMEOUT_MS/);
 assert.ok(source.indexOf('Promise.race([getCJAccessToken()') < source.indexOf('await fetch(url'));
 assert.match(source,/CJ_DETAIL_TIMEOUT/);
 assert.doesNotMatch(source,/token:\s*token|error:\s*error\.message/);
});


test('CJ detail clears the authentication deadline timer on success or failure',()=>{
 assert.match(source,/let authTimer;/);
 assert.match(source,/authTimer = setTimeout\(/);
 assert.match(source,/finally \{\s*clearTimeout\(authTimer\);\s*\}/);
});

test('CJ detail retry backoff is abort-aware and cannot extend beyond deadline',()=>{
 assert.match(source,/import \{ setTimeout as delay \} from 'node:timers\/promises'/);
 assert.match(source,/retryRemaining <= 150/);
 assert.match(source,/AbortSignal\.timeout\(Math\.max\(1, retryRemaining\)\)/);
});

test('CJ detail refuses absent or header-injection tokens before contacting supplier',()=>{
 assert.match(source,/CJ_DETAIL_AUTH_INVALID/);
 assert.ok(source.indexOf("CJ_DETAIL_AUTH_INVALID") < source.indexOf('await fetch(url'));
 assert.match(source,/res\.status\(503\)\.json\(\{ error: 'CJ認証を確認できませんでした。販売を保留します。', code: 'CJ_DETAIL_AUTH_INVALID' \}\)/);
});


test('CJ detail rejects HTTP 200 proxy HTML and other non-JSON content before parsing',()=>{
 assert.match(source,/response\.headers\.get\('content-type'\)/);
 assert.ok(source.includes("mediaType !== 'application/json'"));
 assert.ok(source.includes("/^application\\/[a-z0-9][a-z0-9.+-]*\\+json$/.test(mediaType)"));
 assert.match(source,/CJ_DETAIL_UNEXPECTED_CONTENT_TYPE/);
 assert.ok(source.indexOf("CJ_DETAIL_UNEXPECTED_CONTENT_TYPE") < source.indexOf('const json = await response.json()'));
});
