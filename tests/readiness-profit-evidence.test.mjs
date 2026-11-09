import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../lib/routes/cj-readiness.js',import.meta.url),'utf8');
test('authenticated readiness audit includes actual final-profit integration blockers',()=>{
 for(const id of ['cj-settled-supplier-cost','shopify-payment-fees','approved-ad-and-return-reserves','server-margin-assessment'])assert.ok(src.includes("id:'"+id+"'"),id);
 assert.match(src,/verifiedExternalChecks:0/);
 assert.match(src,/liveIntegrationVerified:false/);
});
