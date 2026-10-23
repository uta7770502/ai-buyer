import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/cj-profit-preview.js',import.meta.url),'utf8');
test('CJ profit preview never marks a browser quote as verified',()=>{
 assert.match(source,/shippingVerified:false/);
 assert.match(source,/requiresServerVerification:true/);
 assert.match(source,/normalizeCjFreightQuote/);
 assert.match(source,/estimateProfit/);
});
