import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/routes/cj-monitor.js',import.meta.url),'utf8');

test('CJ monitor rejects missing and invalid inventory instead of treating it as zero',()=>{
 assert.match(source,/!inventories\.length/);
 assert.match(source,/value === undefined \|\| value === null/);
 assert.match(source,/Number\.isSafeInteger\(n\) \|\| n < 0/);
 assert.match(source,/cj \+ factory > total/);
 assert.match(source,/Number\.isSafeInteger/);
});

test('CJ aggregate inventory is never represented as verified variant inventory',()=>{
 assert.match(source,/variantInventoryVerified:\s*false/);
 assert.match(source,/variantInventoryReason:/);
});

test('CJ monitor validates product identifiers before supplier requests',()=>{
 assert.match(source,/ids\.some\(id => !\/\^\[a-zA-Z0-9:-\]\{1,100\}\$\/\.test\(id\)\)/);
 assert.match(source,/Invalid CJ product ID/);
});

test('CJ monitor rejects duplicate warehouse inventory rows',()=>{
 assert.match(source,/warehouseKeys\.has\(warehouseKey\)/);
 assert.match(source,/CJ倉庫データに重複があります/);
});
