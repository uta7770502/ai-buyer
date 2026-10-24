import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/routes/cj-health.js',import.meta.url),'utf8');
test('CJ health responses are uncached and hide upstream error text',()=>{
 assert.match(source,/Cache-Control','no-store'/);
 assert.match(source,/CJ connectivity check failed/);
 assert.doesNotMatch(source,/error:\s*error\.message/);
});

test('CJ auth and category probes both have bounded network timeouts',()=>{
 assert.match(source,/CJ_HEALTH_TIMEOUT_MS=8000/);
 assert.equal((source.match(/AbortSignal\.timeout\(CJ_HEALTH_TIMEOUT_MS\)/g)||[]).length,2);
});
