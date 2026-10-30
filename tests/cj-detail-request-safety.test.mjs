import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/routes/cj-detail.js',import.meta.url),'utf8');
test('CJ detail requests validate ids, bound timeouts and redact errors',()=>{
 assert.match(source,/Invalid product id/);
 assert.equal((source.match(/AbortSignal\.timeout\(CJ_DETAIL_TIMEOUT_MS\)/g)||[]).length,2);
 assert.match(source,/CJ product detail unavailable/);
 assert.doesNotMatch(source,/error: error\.message/);
});
