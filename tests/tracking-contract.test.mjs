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

const sync=readFileSync(new URL('../lib/routes/cj-tracking-sync.js',import.meta.url),'utf8');

test('tracking writes are opt-in, admin-only, and sandbox-only',()=>{
  assert.match(sync,/req\.method!=='POST'/);
  assert.match(sync,/CJ_SANDBOX_TRACKING_SYNC_ENABLED'!=='true'/);
  assert.match(sync,/AI_BUYER_ADMIN_KEY/);
  assert.match(sync,/linkedSandboxOrder\(shop,id\)/);
  assert.match(sync,/order\.test!==true/);
});
test('tracking write verifies order eligibility and blocks existing fulfillment',()=>{
  assert.match(sync,/order\.cancelledAt/);
  assert.match(sync,/displayFinancialStatus!=='PAID'/);
  assert.match(sync,/displayFulfillmentStatus!=='UNFULFILLED'/);
  assert.match(sync,/\(order\.fulfillments\|\|\[\]\)\.length/);
});
test('tracking write is idempotent and fail closed on ambiguous outcomes',()=>{
  assert.match(sync,/\['SET',lock,'needs_review:'\+tracking,'NX'\]/);
  assert.match(sync,/automaticRetry:false/);
  assert.match(sync,/fulfillmentCreate/);
  assert.match(sync,/const verified=await shopify\(shop,token,QUERY/);
  assert.match(sync,/if\(!fulfillmentVerified\)/);
});

test('tracking sync route is wired to the API router',()=>{
  const router=readFileSync(new URL('../api/cj.js',import.meta.url),'utf8');
  assert.match(router,/import cjTrackingSync from '\.\.\/lib\/routes\/cj-tracking-sync\.js'/);
  assert.match(router,/'tracking-sync':cjTrackingSync/);
});
test('tracking write performs a post-write Shopify read and persists confirmation only afterwards',()=>{
  const verification=sync.indexOf('const verified=await shopify(shop,token,QUERY');
  const confirmation=sync.indexOf("await redis(['SET',lock,'confirmed:'");
  assert.ok(verification>0&&confirmation>verification);
});

test('post-write verification matches the exact created fulfillment ID',()=>{
  assert.match(sync,/fulfillments\{id trackingInfo\{number\}\}/);
  assert.match(sync,/f\.id===payload\.fulfillment\.id/);
});
