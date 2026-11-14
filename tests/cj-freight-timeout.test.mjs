import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/routes/cj-freight.js',import.meta.url),'utf8');
test('CJ freight requests have bounded upstream timeouts and redacted failures',()=>{
 assert.match(source,/CJ_FREIGHT_TIMEOUT_MS=10000/);
 assert.equal((source.match(/AbortSignal\.timeout\(CJ_FREIGHT_TIMEOUT_MS\)/g)||[]).length,2);
 assert.match(source,/CJ送料の確認に失敗しました/);
 assert.doesNotMatch(source,/error:e\.message/);
});
