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

test('release readiness does not claim sandbox checks prove live fulfillment',()=>{
 assert.match(source,/fulfillmentVerified:false/);
 assert.match(source,/liveCjOrdersEnabled:false/);
 assert.match(source,/Actual webhook delivery and fulfillment still require sandbox evidence/);
});
