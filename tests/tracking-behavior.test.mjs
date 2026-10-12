import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../lib/routes/cj-tracking-sync.js';

const env={
  AI_BUYER_ADMIN_KEY:'test-admin',
  CJ_SANDBOX_TRACKING_SYNC_ENABLED:'true',
  SHOPIFY_ALLOWED_SHOP_DOMAIN:'test-shop.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN:'test-token',
  UPSTASH_REDIS_REST_URL:'https://example.test/redis',
  UPSTASH_REDIS_REST_TOKEN:'test-redis',
  CJ_ACCESS_TOKEN:'test-cj'
};
const gid='gid://shopify/Order/123';
const fulfillmentId='gid://shopify/Fulfillment/987';
const order=(fulfillments=[])=>({
  id:gid,test:true,cancelledAt:null,displayFinancialStatus:'PAID',
  displayFulfillmentStatus:fulfillments.length?'FULFILLED':'UNFULFILLED',
  fulfillments,fulfillmentOrders:{pageInfo:{hasNextPage:false},nodes:[{
    id:'gid://shopify/FulfillmentOrder/456',status:'OPEN',
    lineItems:{pageInfo:{hasNextPage:false},nodes:[{id:'line1',remainingQuantity:1}]}
  }]}
});
const json=(data)=>({ok:true,json:async()=>data});
async function invoke({authorization='Bearer test-admin',enabled='true',sandbox=1,shipped=true,shopifyOrder=order(),afterWrite=order([{id:fulfillmentId,trackingInfo:[{number:'TRACK123'}]}]),mutationId=fulfillmentId,lockClaim='OK',shopifyApiError=false}={}){
  const previous={};
  for(const [k,v] of Object.entries({...env,CJ_SANDBOX_TRACKING_SYNC_ENABLED:enabled})){previous[k]=process.env[k];process.env[k]=v;}
  const fetchBefore=globalThis.fetch;
  let writes=0,reads=0,locks=0;
  globalThis.fetch=async(url,opts)=>{
    if(url.startsWith('https://example.test/redis')){
      const cmd=JSON.parse(opts.body);
      if(cmd[0]==='GET')return json({result:'created:CJTEST123'});
      if(cmd[0]==='SET'){locks++;return json({result:locks===1?lockClaim:'OK'});}
      throw Error('unexpected redis operation');
    }
    if(url.includes('getOrderDetail'))return json({result:true,data:{isSandbox:sandbox,orderStatus:shipped?'SHIPPED':'CREATED',trackNumber:'TRACK123'}});
    if(url.includes('graphql.json')){
      if(shopifyApiError)return json({errors:[{message:'API unavailable'}]});
      const body=JSON.parse(opts.body);
      if(body.query.includes('fulfillmentCreate')){writes++;return json({data:{fulfillmentCreate:{fulfillment:{id:mutationId},userErrors:[]}}});}
      reads++;return json({data:{node:reads===1?shopifyOrder:afterWrite}});
    }
    throw Error('unexpected request '+url);
  };
  let statusCode=0,body;
  const res={setHeader(){},status(code){statusCode=code;return this;},json(value){body=value;return value;}};
  try{
    await handler({method:'POST',headers:{authorization},body:{shopifyOrderId:'123'}},res);
    return {statusCode,body,writes,reads,locks};
  }finally{
    globalThis.fetch=fetchBefore;
    for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
}
test('write disabled by default',async()=>{
  const x=await invoke({enabled:'false'});
  assert.equal(x.statusCode,403);assert.equal(x.writes,0);
});
test('unauthorized requests cannot write',async()=>{
  const x=await invoke({authorization:'Bearer wrong'});
  assert.equal(x.statusCode,401);assert.equal(x.writes,0);
});
test('non-sandbox CJ orders cannot write',async()=>{
  const x=await invoke({sandbox:0});
  assert.equal(x.statusCode,503);assert.equal(x.writes,0);
});
test('unshipped CJ orders cannot write',async()=>{
  const x=await invoke({shipped:false});
  assert.equal(x.statusCode,409);assert.equal(x.writes,0);
});
test('eligible sandbox order creates one fulfillment and verifies it',async()=>{
  const x=await invoke();
  assert.equal(x.statusCode,200);assert.equal(x.body.verified,true);
  assert.equal(x.writes,1);assert.equal(x.reads,2);assert.equal(x.locks,2);
});
test('mismatched fulfillment ID never reports success',async()=>{
  const x=await invoke({afterWrite:order([{id:'gid://shopify/Fulfillment/OTHER',trackingInfo:[{number:'TRACK123'}]}])});
  assert.equal(x.statusCode,409);assert.equal(x.body.automaticRetry,false);
  assert.equal(x.writes,1);assert.equal(x.locks,1);
});
test('already fulfilled Shopify order does not create another fulfillment',async()=>{
  const x=await invoke({shopifyOrder:order([{id:'gid://shopify/Fulfillment/OTHER',trackingInfo:[{number:'DIFFERENT'}]}])});
  assert.equal(x.statusCode,409);assert.equal(x.writes,0);
});

test('Redis idempotency conflict blocks all Shopify writes',async()=>{
  const x=await invoke({lockClaim:null});
  assert.equal(x.statusCode,409);
  assert.equal(x.body.automaticRetry,false);
  assert.equal(x.writes,0);
});
test('Shopify verification failure never creates a fulfillment',async()=>{
  const x=await invoke({shopifyApiError:true});
  assert.equal(x.statusCode,503);
  assert.equal(x.body.automaticRetry,false);
  assert.equal(x.writes,0);
});
test('Shopify test flag is required',async()=>{
  const x=await invoke({shopifyOrder:{...order(),test:false}});
  assert.equal(x.statusCode,409);
  assert.equal(x.writes,0);
});
test('Shopify payment must be paid',async()=>{
  const x=await invoke({shopifyOrder:{...order(),displayFinancialStatus:'PENDING'}});
  assert.equal(x.statusCode,409);
  assert.equal(x.writes,0);
});

test('cancelled Shopify order cannot be fulfilled',async()=>{
  const x=await invoke({shopifyOrder:{...order(),cancelledAt:'2026-10-12T00:00:00Z'}});
  assert.equal(x.statusCode,409);
  assert.equal(x.writes,0);
});
test('multiple fulfillment orders require manual review',async()=>{
  const original=order();
  const x=await invoke({shopifyOrder:{...original,fulfillmentOrders:{...original.fulfillmentOrders,nodes:[...original.fulfillmentOrders.nodes,...original.fulfillmentOrders.nodes]}}});
  assert.equal(x.statusCode,409);
  assert.equal(x.writes,0);
});
test('fulfillment order pagination requires manual review',async()=>{
  const original=order();
  const x=await invoke({shopifyOrder:{...original,fulfillmentOrders:{...original.fulfillmentOrders,pageInfo:{hasNextPage:true}}}});
  assert.equal(x.statusCode,409);
  assert.equal(x.writes,0);
});
test('zero remaining quantity prevents fulfillment',async()=>{
  const original=order();
  const fo=original.fulfillmentOrders.nodes[0];
  const x=await invoke({shopifyOrder:{...original,fulfillmentOrders:{...original.fulfillmentOrders,nodes:[{...fo,lineItems:{...fo.lineItems,nodes:[{id:'line1',remainingQuantity:0}]}}]}}});
  assert.equal(x.statusCode,409);
  assert.equal(x.writes,0);
});

test('existing identical Shopify tracking is treated as already synced without writing',async()=>{
  const x=await invoke({shopifyOrder:order([{id:fulfillmentId,trackingInfo:[{number:'TRACK123'}]}])});
  assert.equal(x.statusCode,200);
  assert.equal(x.body.alreadySynced,true);
  assert.equal(x.writes,0);
  assert.equal(x.locks,0);
});
test('unavailable CJ shipment status does not write',async()=>{
  const x=await invoke({shipped:false});
  assert.equal(x.writes,0);
  assert.equal(x.locks,0);
});

test('fulfilled order with different tracking never overwrites existing tracking',async()=>{
  const x=await invoke({shopifyOrder:order([{id:fulfillmentId,trackingInfo:[{number:'OTHER123'}]}])});
  assert.equal(x.statusCode,409);
  assert.equal(x.writes,0);
});
test('Shopify order lookup returning no order blocks fulfillment',async()=>{
  const x=await invoke({shopifyOrder:null});
  assert.equal(x.statusCode,409);
  assert.equal(x.writes,0);
});
test('Shopify order fulfillment status must be UNFULFILLED',async()=>{
  const x=await invoke({shopifyOrder:{...order(),displayFulfillmentStatus:'PARTIALLY_FULFILLED'}});
  assert.equal(x.statusCode,409);
  assert.equal(x.writes,0);
});
