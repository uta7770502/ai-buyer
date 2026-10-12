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
const keys=['SHOPIFY_CLIENT_SECRET','SHOPIFY_ALLOWED_SHOP_DOMAIN','CJ_SANDBOX_ORDER_ENABLED','SHOPIFY_ADMIN_ACCESS_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','CJ_ACCESS_TOKEN','CJ_MAX_ITEMS_PER_ORDER','CJ_MAX_ORDER_VALUE','CJ_ORDER_LIMIT_CURRENCY','CJ_ALLOWED_DESTINATION_COUNTRY','CJ_MAX_FREIGHT_USD'];
async function invoke({order=validOrder,topic='orders/paid',shop='test.myshopify.com',hmacValid=true,enabled='false',validLine=false,fetchMock=null}={}){
  const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const before=globalThis.fetch;
  process.env.SHOPIFY_CLIENT_SECRET=secret;
  process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN='test.myshopify.com';
  process.env.CJ_SANDBOX_ORDER_ENABLED=enabled;
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN='test-shopify-token';
  process.env.UPSTASH_REDIS_REST_URL='https://redis.test';
  process.env.UPSTASH_REDIS_REST_TOKEN='test-redis';
  process.env.CJ_ACCESS_TOKEN='test-cj';
  process.env.CJ_MAX_ITEMS_PER_ORDER='10';
  process.env.CJ_MAX_ORDER_VALUE='10000';
  process.env.CJ_ORDER_LIMIT_CURRENCY='JPY';
  process.env.CJ_ALLOWED_DESTINATION_COUNTRY='JP';
  process.env.CJ_MAX_FREIGHT_USD='50';
  let calls=0;
  globalThis.fetch=async(...args)=>{calls++;if(fetchMock)return fetchMock(...args);throw Error('External API must not be called in rejected webhook tests');};
  if(validLine){order={...order,shipping_address:{country_code:'JP',city:'Tokyo',address1:'1-2-3',name:'Test Customer'},line_items:[{id:9,sku:'CJVARIANT123',quantity:1,fulfillable_quantity:1,variant_id:22,product_id:33}]};}
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

test('catalog verification happens before any CJ request',async()=>{
  const x=await invoke({enabled:'true',validLine:true,order:{...validOrder}});
  assert.equal(x.statusCode,500);
  assert.equal(x.calls,1);
});

test('non-numeric Shopify order IDs are rejected',async()=>{
  const x=await invoke({order:{...validOrder,id:'../../other'}});
  assert.equal(x.statusCode,400);
  assert.equal(x.calls,0);
});
test('missing Shopify order IDs are rejected',async()=>{
  const x=await invoke({order:{...validOrder,id:null}});
  assert.equal(x.statusCode,400);
  assert.equal(x.calls,0);
});

test('invalid Shopify catalog SKU stops before any CJ endpoint',async()=>{
  const urls=[];
  const x=await invoke({
    enabled:'true',validLine:true,
    fetchMock:async(url)=>{
      urls.push(String(url));
      assert.match(String(url),/myshopify\.com/);
      return {ok:true,json:async()=>({data:{node:{id:'gid://shopify/ProductVariant/22',sku:'WRONG_SKU',product:{id:'gid://shopify/Product/33',vendor:'AI BUYER'}}}})};
    }
  });
  assert.equal(x.statusCode,422);
  assert.equal(x.body.needsReview,true);
  assert.equal(x.calls,1);
  assert.equal(urls.some(u=>u.includes('cjdropshipping.com')),false);
});

test('untrusted shop is rejected even when order is unpaid',async()=>{
  const x=await invoke({shop:'other.myshopify.com',order:{...validOrder,financial_status:'pending'}});
  assert.equal(x.statusCode,403);
  assert.equal(x.calls,0);
});
test('untrusted shop is rejected even for unrelated webhook topic',async()=>{
  const x=await invoke({shop:'other.myshopify.com',topic:'orders/create'});
  assert.equal(x.statusCode,403);
  assert.equal(x.calls,0);
});

test('sandbox order is created once and duplicate delivery is skipped',async()=>{
  const reserved=new Set();
  const seen=[];
  const fetchMock=async(url,options={})=>{
    const target=String(url);
    seen.push(target);
    const json=data=>({ok:true,json:async()=>data});
    if(target.includes('myshopify.com'))return json({data:{node:{id:'gid://shopify/ProductVariant/22',sku:'CJVARIANT123',product:{id:'gid://shopify/Product/33',vendor:'AI BUYER'}}}});
    if(target.includes('freightCalculate'))return json({result:true,data:[{logisticName:'Test Shipping',totalPostageFee:5}]});
    if(target==='https://redis.test/'){
      const [cmd,key,value,flag]=JSON.parse(options.body);
      if(cmd!=='SET')throw Error('Unexpected Redis command');
      if(flag==='NX'&&reserved.has(key))return json({result:null});
      reserved.add(key);
      return json({result:'OK'});
    }
    if(target.includes('createOrderV2'))return json({result:true,data:{orderId:'CJ-SANDBOX-123',orderNumber:'TEST-123'}});
    throw Error('Unexpected external request: '+target);
  };
  const first=await invoke({enabled:'true',validLine:true,fetchMock});
  const second=await invoke({enabled:'true',validLine:true,fetchMock});
  assert.equal(first.statusCode,200);
  assert.equal(first.body.sandbox,true);
  assert.equal(second.statusCode,200);
  assert.equal(second.body.skipped,true);
  assert.equal(seen.filter(u=>u.includes('createOrderV2')).length,1);
});

test('ambiguous CJ timeout is held for review and never retried',async()=>{
  const redis=new Map();
  let attempts=0;
  const fetchMock=async(url,options={})=>{
    const target=String(url);
    const json=data=>({ok:true,json:async()=>data});
    if(target.includes('myshopify.com'))return json({data:{node:{id:'gid://shopify/ProductVariant/22',sku:'CJVARIANT123',product:{id:'gid://shopify/Product/33',vendor:'AI BUYER'}}}});
    if(target.includes('freightCalculate'))return json({result:true,data:[{logisticName:'Test Shipping',totalPostageFee:5}]});
    if(target==='https://redis.test/'){
      const [cmd,key,value,flag]=JSON.parse(options.body);
      if(cmd!=='SET')throw Error('Unexpected Redis command');
      if(flag==='NX'&&redis.has(key))return json({result:null});
      redis.set(key,value);
      return json({result:'OK'});
    }
    if(target.includes('createOrderV2')){attempts++;throw Error('Simulated CJ timeout');}
    throw Error('Unexpected request: '+target);
  };
  const first=await invoke({enabled:'true',validLine:true,fetchMock});
  const second=await invoke({enabled:'true',validLine:true,fetchMock});
  assert.equal(first.statusCode,202);
  assert.equal(first.body.needsReview,true);
  assert.equal(second.statusCode,200);
  assert.equal(second.body.skipped,true);
  assert.equal(attempts,1);
  assert.ok([...redis.values()].some(v=>v==='needs_review:unknown_cj_result'));
});

test('CJ success with failed final persistence requires review without reordering',async()=>{
  const redis=new Set();
  let orders=0;
  const fetchMock=async(url,options={})=>{
    const target=String(url);
    const json=data=>({ok:true,json:async()=>data});
    if(target.includes('myshopify.com'))return json({data:{node:{id:'gid://shopify/ProductVariant/22',sku:'CJVARIANT123',product:{id:'gid://shopify/Product/33',vendor:'AI BUYER'}}}});
    if(target.includes('freightCalculate'))return json({result:true,data:[{logisticName:'Test Shipping',totalPostageFee:5}]});
    if(target==='https://redis.test/'){
      const [cmd,key,value,flag]=JSON.parse(options.body);
      if(cmd!=='SET')throw Error('Unexpected Redis command');
      if(flag==='NX'){
        if(redis.has(key))return json({result:null});
        redis.add(key);
        return json({result:'OK'});
      }
      throw Error('Simulated final state persistence outage');
    }
    if(target.includes('createOrderV2')){orders++;return json({result:true,data:{orderId:'CJ-OK-1'}});}
    throw Error('Unexpected request: '+target);
  };
  const first=await invoke({enabled:'true',validLine:true,fetchMock});
  const second=await invoke({enabled:'true',validLine:true,fetchMock});
  assert.equal(first.statusCode,202);
  assert.equal(first.body.needsReview,true);
  assert.equal(second.statusCode,200);
  assert.equal(second.body.skipped,true);
  assert.equal(orders,1);
});

test('CJ rejection is recorded for review and never automatically retried',async()=>{
  const redis=new Map();
  let attempts=0;
  const fetchMock=async(url,options={})=>{
    const target=String(url);
    const json=data=>({ok:true,json:async()=>data});
    if(target.includes('myshopify.com'))return json({data:{node:{id:'gid://shopify/ProductVariant/22',sku:'CJVARIANT123',product:{id:'gid://shopify/Product/33',vendor:'AI BUYER'}}}});
    if(target.includes('freightCalculate'))return json({result:true,data:[{logisticName:'Test Shipping',totalPostageFee:5}]});
    if(target==='https://redis.test/'){
      const [cmd,key,value,flag]=JSON.parse(options.body);
      if(cmd!=='SET')throw Error('Unexpected Redis command');
      if(flag==='NX'&&redis.has(key))return json({result:null});
      redis.set(key,value);
      return json({result:'OK'});
    }
    if(target.includes('createOrderV2')){attempts++;return json({result:false,message:'Simulated CJ rejection'});}
    throw Error('Unexpected request: '+target);
  };
  const first=await invoke({enabled:'true',validLine:true,fetchMock});
  const second=await invoke({enabled:'true',validLine:true,fetchMock});
  assert.equal(first.statusCode,202);
  assert.equal(first.body.needsReview,true);
  assert.equal(second.statusCode,200);
  assert.equal(second.body.skipped,true);
  assert.equal(attempts,1);
  assert.ok([...redis.values()].some(v=>v==='needs_review:cj_rejected'));
});
