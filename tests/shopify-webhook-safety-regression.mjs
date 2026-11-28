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
async function request(payload, {signature=true,topic='orders/paid',origin=shop,enabled=false}={}) {
  process.env.SHOPIFY_CLIENT_SECRET=secret;
  process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN=shop;
  process.env.CJ_SANDBOX_ORDER_ENABLED=enabled?'true':'false';
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

test('sandbox opt-in without durable Redis refuses dispatch', async()=>{
  const previous={enabled:process.env.CJ_SANDBOX_ORDER_ENABLED,url:process.env.UPSTASH_REDIS_REST_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN};
  try{
    const raw=Buffer.from(JSON.stringify(order()));
    process.env.SHOPIFY_CLIENT_SECRET=secret;
    process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN=shop;
    process.env.CJ_SANDBOX_ORDER_ENABLED='true';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const req=Readable.from([raw]);
    req.method='POST';
    req.headers={'x-shopify-hmac-sha256':crypto.createHmac('sha256',secret).update(raw).digest('base64'),'x-shopify-shop-domain':shop,'x-shopify-topic':'orders/paid','x-shopify-webhook-id':'no-redis-event'};
    const res={statusCode:200,body:null,status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;},end(){return this;}};
    await handler(req,res);
    assert.equal(res.statusCode,503);
    assert.match(res.body.error,/deduplication/i);
  }finally{
    for(const [key,value] of Object.entries({CJ_SANDBOX_ORDER_ENABLED:previous.enabled,UPSTASH_REDIS_REST_URL:previous.url,UPSTASH_REDIS_REST_TOKEN:previous.token})){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});

test('ODDLY webhook verifies latest factory stock before freight or reservation and never creates an order when immediate stock is absent',async t=>{
 const env={UPSTASH_REDIS_REST_URL:'https://redis.invalid',UPSTASH_REDIS_REST_TOKEN:'test',CJ_ACCESS_TOKEN:'test',SHOPIFY_ADMIN_ACCESS_TOKEN:'test',CJ_MAX_ITEMS_PER_ORDER:'5',CJ_MAX_ORDER_VALUE:'5000',CJ_ORDER_LIMIT_CURRENCY:'JPY',CJ_ALLOWED_DESTINATION_COUNTRY:'JP',CJ_MAX_FREIGHT_USD:'25'};
 const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(()=>{for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  calls.push(String(url));
  if(String(url).includes('graphql.json'))return {ok:true,json:async()=>({data:{node:{id:'gid://shopify/ProductVariant/2',sku:'1234567890123',product:{id:'gid://shopify/Product/1',vendor:'ODDLY'}}}})};
  if(String(url).includes('/product/stock/queryByVid?'))return {ok:true,json:async()=>({result:true,data:[{cjInventoryNum:0,factoryInventoryNum:10,totalInventoryNum:10}]})};
  throw Error('Unexpected request '+url);
 });
 const r=await request(order({line_items:[{id:3,variant_id:2,product_id:1,sku:'1234567890123',quantity:1,fulfillable_quantity:1}]}),{enabled:true});
 assert.equal(r.statusCode,409);assert.equal(r.body.requiresFactoryReplenishment,true);assert.equal(r.body.orderCreated,false);assert.equal(r.body.dispatchPlanningWindow.guaranteed,false);
 assert.equal(calls.length,2);assert.ok(!calls.some(x=>x.includes('freightCalculate')||x.includes('createOrder')||x.includes('redis.invalid')));
});
