import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/routes/release-readiness.js',import.meta.url),'utf8');
test('release readiness explicitly preserves unverified integration milestones',()=>{
 for(const key of ['variantLevelInventoryVerified','shopifyDraftCreationEndToEndVerified','realOrderFulfillmentTrackingReturnsVerified','tenPetProductsSupplierVerified','comprehensiveLivePrelaunchAuditPassed']){
  assert.match(source,new RegExp(key+':false'));
 }
 assert.match(source,/readyForLive:false/);
 assert.match(source,/liveIntegrationVerified:false/);
});
