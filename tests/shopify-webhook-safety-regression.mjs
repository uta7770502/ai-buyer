// Standalone regression tests: node --test tests/shopify-webhook-safety-regression.mjs
// No real Shopify or CJ requests are made by these fail-closed cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import handler from '../api/shopify-order-webhook.js';

const shop = 'adps-safety-test.myshopify.com';
const secret = 'local-test-secret';
const original = Object.fromEntries(['SHOPIFY_CLIENT_SECRET','SHOPIFY_ALLOWED_SHOP_DOMAIN','CJ_SANDBOX_ORDER_ENABLED'].map(k=>[k,process.env[k]]));
test.after(() => { for (const [key,value] of Object.entries(original)) { if(value===undefined) delete process.env[key]; else process.env[key]=value; } });

function order(overrides={}) {
  return {
    id: 123456789, test: true, financial_status: 'paid', total_price: '1500',
    currency: 'JPY', line_items: [{sku:'ABCDEF123',quantity:1,fulfillable_quantity:1}],
    shipping_address: {country_code:'JP',zip:'1000001',city:'Chiyoda',address1:'1-1',name:'Test Customer'},
    ...overrides
  };
}
async function request(payload, {signature=true,topic='orders/paid',origin=shop}={}) {
  process.env.SHOPIFY_CLIENT_SECRET=secret;
  process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN=shop;
  process.env.CJ_SANDBOX_ORDER_ENABLED='false';
  const raw=Buffer.from(JSON.stringify(payload));
  const hmac=crypto.createHmac('sha256',secret).update(raw).digest('base64');
  const req=Readable.from([raw]);
  req.method='POST';
  req.headers={
    'x-shopify-hmac-sha256': signature?hmac:'invalid',
    'x-shopify-shop-domain':origin,
    'x-shopify-topic':topic,
    'x-shopify-webhook-id':'regression-event-1'
  };
  const res={
    statusCode:200, body:undefined,
    status(code){this.statusCode=code;return this;},
    json(value){this.body=value;return this;},
    end(){return this;}
  };
  await handler(req,res);
  return res;
}
test('invalid HMAC is rejected', async()=>{
  const r=await request(order(),{signature:false});
  assert.equal(r.statusCode,401);
});
test('webhook from a different shop is rejected', async()=>{
  const r=await request(order(),{origin:'untrusted.myshopify.com'});
  assert.equal(r.statusCode,403);
});
test('unrelated webhook topic is skipped', async()=>{
  const r=await request(order(),{topic:'orders/create'});
  assert.equal(r.statusCode,200);
  assert.equal(r.body.skipped,true);
});
test('non-test order cannot reach sandbox dispatch', async()=>{
  const r=await request(order({test:false}));
  assert.equal(r.statusCode,422);
  assert.match(r.body.error,/test orders/i);
});
test('missing shipping city requires manual review', async()=>{
  const r=await request(order({shipping_address:{country_code:'JP',zip:'1000001',address1:'1-1',name:'Test Customer'}}));
  assert.equal(r.statusCode,422);
  assert.equal(r.body.needsReview,true);
});
test('valid test order stays disabled without explicit sandbox opt-in', async()=>{
  const r=await request(order());
  assert.equal(r.statusCode,503);
  assert.match(r.body.error,/disabled/i);
});

test('zero-value paid order requires review', async()=>{
  const r=await request(order({total_price:'0'}));
  assert.equal(r.statusCode,200);
  assert.equal(r.body.skipped,true);
  assert.equal(r.body.needsReview,true);
});
test('refunded order requires review', async()=>{
  const r=await request(order({refunds:[{id:1}]}));
  assert.equal(r.statusCode,200);
  assert.equal(r.body.needsReview,true);
});
test('fulfilled order is skipped', async()=>{
  const r=await request(order({fulfillment_status:'fulfilled'}));
  assert.equal(r.statusCode,200);
  assert.equal(r.body.skipped,true);
});
test('missing order identifier is rejected', async()=>{
  const r=await request(order({id:null}));
  assert.equal(r.statusCode,400);
});
test('cancelled order is skipped', async()=>{
  const r=await request(order({cancelled_at:'2026-10-14T00:00:00Z'}));
  assert.equal(r.statusCode,200);
  assert.equal(r.body.skipped,true);
});
