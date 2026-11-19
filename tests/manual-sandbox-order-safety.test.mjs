import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/shopify-sandbox-order.js';
function setup(t,override={},stored=null){
 const env={VERCEL_ENV:'test',AI_BUYER_ADMIN_KEY:'admin',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',SHOPIFY_ADMIN_ACCESS_TOKEN:'token',CJ_ACCESS_TOKEN:'cj',CJ_SANDBOX_ORDER_ENABLED:'true',UPSTASH_REDIS_REST_URL:'https://redis.invalid',UPSTASH_REDIS_REST_TOKEN:'redis',CJ_MAX_ITEMS_PER_ORDER:'10',CJ_MAX_ORDER_VALUE:'100',CJ_MAX_FREIGHT_USD:'10',CJ_ORDER_LIMIT_CURRENCY:'USD'};
 const old={...process.env};Object.assign(process.env,env);t.after(()=>{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old)});
 const order={test:true,cancelledAt:null,displayFinancialStatus:'PAID',currencyCode:'USD',currentTotalPriceSet:{shopMoney:{amount:'20'}},shippingAddress:{name:'Test',address1:'Test',city:'Test',countryCodeV2:'JP'},lineItems:{pageInfo:{hasNextPage:false},nodes:[{id:'gid://shopify/LineItem/1',sku:'CJ-VID123',quantity:1}]},...override};
 let state=stored,creates=0,failSave=false,ambiguous=false;const calls=[];
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  const body=JSON.parse(opts.body);calls.push({url,body});const response=result=>({ok:true,json:async()=>result});
  if(url.includes('graphql.json'))return response({data:{order}});
  if(url.startsWith('https://redis.invalid')){if(body[0]==='GET')return response({result:state});if(body[0]==='SET'){if(body.includes('NX')&&state!==null)return response({result:null});if(failSave&&body[2].startsWith('created:'))return response({result:null});state=body[2];return response({result:'OK'});}throw Error('Unexpected Redis write');}
  if(url.endsWith('/logistic/freightCalculate'))return response({result:true,data:[{logisticName:'Test',totalPostageFee:2}]});
  if(url.endsWith('/shopping/order/createOrderV2')){creates++;assert.equal(body.isSandbox,1);assert.equal(body.payType,3);if(ambiguous)throw Error('Timeout');return response({result:true,data:{orderId:'CJ-123'}});}
  throw Error('Unexpected API');
 });
 return {calls,get creates(){return creates},set failSave(v){failSave=v},set ambiguous(v){ambiguous=v},async run(){const r={code:200,setHeader(){},status(c){this.code=c;return this},json(b){this.body=b;return this}};await handler({method:'POST',headers:{authorization:'Bearer admin'},body:{orderId:'123'}},r);return r;}};
}
for(const override of [{test:false},{test:undefined},{cancelledAt:'2026-11-13'},{cancelledAt:undefined},{lineItems:{pageInfo:{hasNextPage:true},nodes:[]}},{lineItems:{nodes:[]}}])test('ineligible or incomplete order fails before Redis and CJ '+JSON.stringify(override),async t=>{const f=setup(t,override);assert.equal((await f.run()).code,422);assert.equal(f.calls.length,1)});
for(const value of ['reserved','created:','unknown','needs_review:unknown_cj_result','',42])test('existing unconfirmed reservation never creates another order '+JSON.stringify(value),async t=>{const f=setup(t,{},value);assert.equal((await f.run()).code,409);assert.equal(f.creates,0);assert.ok(!f.calls.some(c=>c.body[0]==='SET'));});
for(const [key,value] of [['CJ_MAX_ITEMS_PER_ORDER',''],['CJ_MAX_ITEMS_PER_ORDER','1.5'],['CJ_MAX_ORDER_VALUE','NaN'],['CJ_MAX_FREIGHT_USD','0']])test('invalid limit fails before Redis '+key+value,async t=>{const f=setup(t);process.env[key]=value;assert.equal((await f.run()).code,503);assert.equal(f.calls.length,1)});
for(const quantity of [0,-1,1.5,'1'])test('invalid line quantity fails closed '+JSON.stringify(quantity),async t=>{const f=setup(t,{lineItems:{pageInfo:{hasNextPage:false},nodes:[{sku:'CJ-VID123',quantity}]}});assert.equal((await f.run()).code,422);assert.equal(f.creates,0)});
test('confirmed sandbox order is created once across duplicate requests',async t=>{const f=setup(t);assert.equal((await f.run()).body.ok,true);assert.equal((await f.run()).body.existing,true);assert.equal(f.creates,1)});
test('concurrent requests create at most one sandbox order',async t=>{const f=setup(t);await Promise.all([f.run(),f.run()]);assert.equal(f.creates,1)});
test('ambiguous creation is not retried',async t=>{const f=setup(t);f.ambiguous=true;assert.equal((await f.run()).body.needsReview,true);assert.equal((await f.run()).code,409);assert.equal(f.creates,1)});
test('failed result persistence does not claim success or retry',async t=>{const f=setup(t);f.failSave=true;assert.equal((await f.run()).body.needsReview,true);assert.equal((await f.run()).code,409);assert.equal(f.creates,1)});
