import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../lib/routes/cj-order-tracking.js',import.meta.url),'utf8');

test('tracking endpoint is read-only and requires admin auth',()=>{
  assert.match(source,/req\.method!=='GET'/);
  assert.match(source,/AI_BUYER_ADMIN_KEY/);
  assert.doesNotMatch(source,/fulfillmentCreate\s*\(/);
});
test('CJ sandbox shipment requires both tracking and shipment status',()=>{
  assert.match(source,/const shipmentConfirmed=Boolean\(cjTracking\)/);
  assert.match(source,/\['SHIPPED','DELIVERED'\]/);
});
test('Shopify sync eligibility requires paid, unfulfilled, uncancelled test order',()=>{
  assert.match(source,/so\?\.test!==true/);
  assert.match(source,/!shopifyOrderCancelled&&shopifyFinancialStatus==='PAID'&&shopifyFulfillmentStatus==='UNFULFILLED'/);
});
test('Shopify sync is never treated as verified on API failure',()=>{
  assert.match(source,/let shopifySyncVerified=false/);
  assert.match(source,/shopifyLookupError='Shopify tracking lookup unavailable'/);
});
