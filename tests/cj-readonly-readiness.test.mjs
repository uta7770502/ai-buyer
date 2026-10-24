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
