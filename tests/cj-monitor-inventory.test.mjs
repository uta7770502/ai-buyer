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
