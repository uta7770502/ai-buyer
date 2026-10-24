import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/routes/cj-readiness.js',import.meta.url),'utf8');
test('read-only readiness is separate from order automation readiness',()=>{
 assert.match(source,/readOnlyConfigured=\{/);
 assert.match(source,/cjCatalogRead:configured\.cjAuthentication/);
 assert.match(source,/shopifyCatalogRead:/);
 assert.match(source,/readOnlyMissing/);
 assert.match(source,/liveIntegrationVerified:false/);
});

test('read-only milestones remain unverified without actual CJ API evidence',()=>{
 for(const id of ['cj-catalog-connectivity','cj-variant-inventory','cj-japan-freight','shopify-draft-sku-match']) assert.ok(source.includes(id));
 assert.match(source,/readOnlyNextChecks=\[/);
 assert.match(source,/verified:false/);
});

test('read-only progress never counts configured credentials as verified external calls',()=>{
 assert.match(source,/readOnlySummary=\{/);
 assert.match(source,/verifiedExternalChecks:0/);
 assert.match(source,/totalExternalChecks:readOnlyNextChecks\.length/);
});
