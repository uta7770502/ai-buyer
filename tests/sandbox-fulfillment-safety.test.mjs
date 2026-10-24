import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sandbox=readFileSync(new URL('../lib/routes/cj-sandbox-simulate.js',import.meta.url),'utf8');
const fulfillment=readFileSync(new URL('../lib/routes/shopify-fulfillment-sync.js',import.meta.url),'utf8');
const tracking=readFileSync(new URL('../lib/routes/cj-tracking-sync.js',import.meta.url),'utf8');

test('sandbox simulation is explicitly local and never represents a real payment or shipment',()=>{
  assert.match(sandbox,/localSimulation:true/);
  assert.match(sandbox,/realPayment:false/);
  assert.match(sandbox,/realShipment:false/);
  assert.match(sandbox,/CJ_SANDBOX_ORDER_ENABLED!=='true'/);
});

test('fulfillment sync requires feature flag, exact dry-run preflight, and idempotency reservation',()=>{
  assert.match(fulfillment,/SHOPIFY_FULFILLMENT_SYNC_ENABLED!=='true'/);
  assert.match(fulfillment,/validPreflight\(/);
  assert.match(fulfillment,/Run a fresh dry-run/);
  assert.match(fulfillment,/\['SET',key,'reserved','NX'\]/);
  assert.match(fulfillment,/automaticRetry:false/);
});

test('tracking sync only accepts verified paid uncancelled test orders and refuses automatic retry',()=>{
  assert.match(tracking,/order\.test!==true/);
  assert.match(tracking,/displayFinancialStatus!=='PAID'/);
  assert.match(tracking,/order\.cancelledAt/);
  assert.match(tracking,/automaticRetry:false/);
  assert.match(tracking,/notifyCustomer:false/);
});
