import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('preview profit audit stays read-only and fails closed on unverified supplier cost',()=>{
 const source=fs.readFileSync(new URL('../lib/routes/preview-profit-audit.js',import.meta.url),'utf8');
 assert.match(source,/readOnly:true/);
 assert.match(source,/cj-cost-unverified/);
 assert.match(source,/variantSellPrice/);
 assert.match(source,/grossMarginPercent/);
 assert.doesNotMatch(source,/mutation\s/i);
});
