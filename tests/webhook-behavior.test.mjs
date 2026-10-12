import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import handler from '../api/shopify-order-webhook.js';

const secret='test-only-webhook-secret';
const validOrder={
  id:123,test:true,financial_status:'paid',current_total_price:'100.00',
  currency:'JPY',line_items:[],shipping_address:{country_code:'JP'}
};
const keys=['SHOPIFY_CLIENT_SECRET','SHOPIFY_ALLOWED_SHOP_DOMAIN','CJ_SANDBOX_ORDER_ENABLED'];
async function invoke({order=validOrder,topic='orders/paid',shop='test.myshopify.com',hmacValid=true,enabled='false'}={}){
  const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const before=globalThis.fetch;
  process.env.SHOPIFY_CLIENT_SECRET=secret;
  process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN='test.myshopify.com';
  process.env.CJ_SANDBOX_ORDER_ENABLED=enabled;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('External API must not be called in rejected webhook tests');};
  const raw=Buffer.from(JSON.stringify(order));
  const signature=crypto.createHmac('sha256',secret).update(raw).digest('base64');
  const req=Readable.from([raw]);
  req.method='POST';
  req.headers={
    'x-shopify-hmac-sha256':hmacValid?signature:'invalid',
    'x-shopify-topic':topic,
    'x-shopify-shop-domain':shop,
    'x-shopify-webhook-id':'event-123'
  };
  let statusCode=0,body;
  const res={status(n){statusCode=n;return this;},json(v){body=v;return this;},end(){return this;}};
  try{await handler(req,res);return {statusCode,body,calls};}
  finally{
    globalThis.fetch=before;
    for(const [k,v] of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
}
test('invalid Shopify HMAC is rejected without side effects',async()=>{
  const x=await invoke({hmacValid:false});
  assert.equal(x.statusCode,401);assert.equal(x.calls,0);
});
test('other webhook topics do not create CJ orders',async()=>{
  const x=await invoke({topic:'orders/create'});
  assert.equal(x.statusCode,200);assert.equal(x.body.skipped,true);assert.equal(x.calls,0);
});
test('unpaid orders do not create CJ orders',async()=>{
  const x=await invoke({order:{...validOrder,financial_status:'pending'}});
  assert.equal(x.statusCode,200);assert.equal(x.body.skipped,true);assert.equal(x.calls,0);
});
test('zero-value orders require review without side effects',async()=>{
  const x=await invoke({order:{...validOrder,current_total_price:'0'}});
  assert.equal(x.statusCode,200);assert.equal(x.body.needsReview,true);assert.equal(x.calls,0);
});
test('cancelled orders are skipped',async()=>{
  const x=await invoke({order:{...validOrder,cancelled_at:'2026-10-12T00:00:00Z'}});
  assert.equal(x.statusCode,200);assert.equal(x.body.skipped,true);assert.equal(x.calls,0);
});
test('shop mismatch is blocked before CJ requests',async()=>{
  const x=await invoke({shop:'other.myshopify.com'});
  assert.equal(x.statusCode,403);assert.equal(x.calls,0);
});
test('sandbox order automation is disabled by default',async()=>{
  const x=await invoke();
  assert.equal(x.statusCode,503);assert.equal(x.calls,0);
});
