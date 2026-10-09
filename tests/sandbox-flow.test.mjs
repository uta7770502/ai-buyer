import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import webhook from '../api/shopify-order-webhook.js';
import simulate from '../lib/routes/cj-sandbox-simulate.js';
import tracking from '../lib/routes/cj-order-tracking.js';
import sync from '../lib/routes/shopify-fulfillment-sync.js';
import status from '../lib/routes/automation-order-status.js';
const env={AI_BUYER_ADMIN_KEY:'test-admin',SHOPIFY_CLIENT_SECRET:'test-secret',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',CJ_ACCESS_TOKEN:'test-token',UPSTASH_REDIS_REST_URL:'https://redis.invalid',UPSTASH_REDIS_REST_TOKEN:'test-store',CJ_SANDBOX_ORDER_ENABLED:'true',SHOPIFY_FULFILLMENT_SYNC_ENABLED:'true',CJ_MAX_ITEMS_PER_ORDER:'10',CJ_MAX_ORDER_VALUE:'100',CJ_MAX_FREIGHT_USD:'10',CJ_ORDER_LIMIT_CURRENCY:'USD'};
const headers={authorization:'Bearer test-admin',cookie:'shopify_access_token=test-shop; shopify_connected_shop=test.myshopify.com'};
const response=data=>({ok:true,json:async()=>data});
const res=()=>({code:200,setHeader(){},status(c){this.code=c;return this},json(d){this.data=d;return this},end(){return this}});
async function call(handler,body={},method='POST'){const r=res();await handler({method,body,query:body,headers},r);return r}
function fixture(t,{sandbox=1,simulationTimeout=false,cjTimeout=false}={}){
 const old={...process.env};Object.assign(process.env,env);
 t.after(()=>{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old)});
 const store=new Map(),calls=[],cjOrder={orderId:'CJ-123',isSandbox:sandbox,orderStatus:'CREATED',trackNumber:''};
 let creates=0,fulfillments=0;
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  const body=opts.body?JSON.parse(opts.body):null;calls.push({url:String(url),body});
  if(String(url).startsWith('https://redis.invalid')){
   const [cmd,key,value,...flags]=body;
   if(cmd==='GET')return response({result:store.get(key)??null});
   if(cmd==='SET'){
    if(flags.includes('NX')&&store.has(key))return response({result:null});
    store.set(key,value);return response({result:'OK'});
   }
   throw Error('Unexpected Redis command');
  }
  if(String(url).endsWith('/logistic/freightCalculate'))return response({result:true,data:[{logisticName:'Mock shipping',totalPostageFee:2}]});
  if(String(url).endsWith('/shopping/order/createOrderV2')){
   assert.equal(body.isSandbox,1);assert.equal(body.payType,3);creates++;
   if(cjTimeout)throw Error('Timeout after acceptance');
   return response({result:true,data:{orderId:cjOrder.orderId}});
  }
  if(String(url).includes('/shopping/order/getOrderDetail?'))return response({result:true,data:{...cjOrder}});
  if(String(url).endsWith('/shopping/sandbox/simulatePay')){
   assert.equal(sandbox,1);assert.equal(body.orderId,cjOrder.orderId);
   if(simulationTimeout)throw Error('Timeout after acceptance');
   cjOrder.orderStatus='UNSHIPPED';return response({result:true,data:true});
  }
  if(String(url).endsWith('/shopping/sandbox/updateTrackNumber')){
   assert.equal(sandbox,1);assert.equal(cjOrder.orderStatus,'UNSHIPPED');assert.match(body.trackNumber,/^SBX[A-F0-9]{24}$/);
   cjOrder.trackNumber=body.trackNumber;return response({result:true,data:true});
  }
  if(String(url).endsWith('/graphql.json')){
   if(body.query.startsWith('query'))return response({data:{order:{test:true,cancelledAt:null,displayFinancialStatus:'PAID',fulfillmentOrders:{pageInfo:{hasNextPage:false},nodes:fulfillments?[]:[{id:'gid://shopify/FulfillmentOrder/1',status:'OPEN',supportedActions:[{action:'CREATE_FULFILLMENT'}]}]}}}});
   assert.equal(body.variables.fulfillment.notifyCustomer,false);fulfillments++;
   return response({data:{fulfillmentCreate:{fulfillment:{id:'gid://shopify/Fulfillment/99',status:'SUCCESS'},userErrors:[]}}});
  }
  throw Error('Unexpected external API; real payment endpoints are forbidden');
 });
 async function paidWebhook({validSignature=true,testOrder=true}={}){
  const raw=Buffer.from(JSON.stringify({id:123,test:testOrder,financial_status:'paid',currency:'USD',total_price:'20',line_items:[{id:456,sku:'CJ-VID123',quantity:1}],shipping_address:{country_code:'JP',country:'Japan',city:'Test City',address1:'Test address',name:'Sandbox Tester'}}));
  const req={method:'POST',headers:{'x-shopify-topic':'orders/paid','x-shopify-shop-domain':'test.myshopify.com','x-shopify-webhook-id':'test-event','x-shopify-hmac-sha256':validSignature?crypto.createHmac('sha256','test-secret').update(raw).digest('base64'):'invalid'},async *[Symbol.asyncIterator](){yield raw}};
  const r=res();await webhook(req,r);return r;
 }
 return {store,calls,cjOrder,paidWebhook,get creates(){return creates},get fulfillments(){return fulfillments}};
}
test('sandbox journey: paid webhook → CJ → simulated tracking → dry-run → Shopify → duplicate verification',async t=>{
 const f=fixture(t);
 assert.equal((await f.paidWebhook()).data.ok,true);
 assert.equal((await f.paidWebhook()).data.skipped,true);assert.equal(f.creates,1);
 const lookup=await call(status,{orderId:'123'},'GET');assert.equal(lookup.data.cjOrderId,'CJ-123');
 assert.equal((await call(simulate,{orderId:'123',phase:'payment'})).data.ok,true);
 assert.equal((await call(simulate,{orderId:'123',phase:'tracking'})).data.ok,true);
 const track=await call(tracking,{orderId:'CJ-123'},'GET');assert.equal(track.data.sandbox,true);assert.ok(track.data.trackingNumber);
 const p={orderId:'gid://shopify/Order/123',trackingNumber:track.data.trackingNumber};
 const pre=await call(sync,{...p,dryRun:true});assert.equal(pre.data.eligible,true);assert.equal(f.fulfillments,0);
 assert.equal((await call(sync,{...p,preflightToken:pre.data.preflightToken})).data.ok,true);
 const duplicate=await call(sync,{...p,checkOnly:true});assert.equal(duplicate.data.duplicateConfirmed,true);assert.equal(f.fulfillments,1);
 assert.equal((await call(simulate,{orderId:'123',phase:'tracking'})).data.skipped,true);
 assert.equal(f.calls.filter(x=>x.url.endsWith('/shopping/sandbox/updateTrackNumber')).length,1);
});
test('unknown CJ creation remains reserved and never auto-retries',async t=>{
 const f=fixture(t,{cjTimeout:true});assert.equal((await f.paidWebhook()).data.needsReview,true);
 await f.paidWebhook();assert.equal(f.creates,1);
 const r=await call(status,{orderId:'123'},'GET');assert.equal(r.data.needsReview,true);
 assert.equal((await call(simulate,{orderId:'123',phase:'payment'})).data.ok,false);
});
test('unknown simulation result is blocked on repeat',async t=>{
 const f=fixture(t,{simulationTimeout:true});await f.paidWebhook();
 assert.equal((await call(simulate,{orderId:'123',phase:'payment'})).data.needsReview,true);
 assert.equal((await call(simulate,{orderId:'123',phase:'payment'})).code,409);
 assert.equal(f.calls.filter(x=>x.url.endsWith('/shopping/sandbox/simulatePay')).length,1);
});
test('sandbox simulator rejects CJ live orders and unrelated IDs',async t=>{
 const f=fixture(t,{sandbox:0});await f.paidWebhook();
 assert.equal((await call(simulate,{orderId:'123',phase:'payment'})).data.ok,false);
 assert.equal((await call(simulate,{orderId:'999',phase:'payment'})).data.ok,false);
 assert.equal(f.calls.filter(x=>x.url.includes('/shopping/sandbox/')).length,0);
});
test('bad HMAC is rejected before any external request',async t=>{
 const f=fixture(t);assert.equal((await f.paidWebhook({validSignature:false})).code,401);assert.equal(f.calls.length,0);
});
test('sandbox disabled blocks simulation before accessing services',async t=>{
 const f=fixture(t);process.env.CJ_SANDBOX_ORDER_ENABLED='false';
 assert.equal((await call(simulate,{orderId:'123',phase:'payment'})).code,503);assert.equal(f.calls.length,0);
});
