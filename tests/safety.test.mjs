import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import sync from '../lib/routes/shopify-fulfillment-sync.js';
import readiness from '../lib/routes/release-readiness.js';
import webhook from '../api/shopify-order-webhook.js';
import setup from '../api/shopify-setup-orders.js';
import cj from '../api/cj.js';
import diagnostics from '../api/diagnostics.js';
const env={AI_BUYER_ADMIN_KEY:'test-admin',SHOPIFY_CLIENT_SECRET:'test-secret',SHOPIFY_CLIENT_ID:'test-id',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',CJ_ACCESS_TOKEN:'test-cj',UPSTASH_REDIS_REST_URL:'https://redis.invalid',UPSTASH_REDIS_REST_TOKEN:'test-redis',CJ_SANDBOX_ORDER_ENABLED:'true',SHOPIFY_FULFILLMENT_SYNC_ENABLED:'true',CJ_MAX_ITEMS_PER_ORDER:'10',CJ_MAX_ORDER_VALUE:'100',CJ_MAX_FREIGHT_USD:'10',CJ_ORDER_LIMIT_CURRENCY:'USD'};
const headers={authorization:'Bearer test-admin',cookie:'shopify_access_token=test-token; shopify_connected_shop=test.myshopify.com'};
const payload={orderId:'gid://shopify/Order/123',trackingNumber:'TRACK123'};
const target={id:'gid://shopify/FulfillmentOrder/1',status:'OPEN',supportedActions:[{action:'CREATE_FULFILLMENT'}]};
const order={id:payload.orderId,test:true,cancelledAt:null,displayFinancialStatus:'PAID',fulfillmentOrders:{nodes:[target],pageInfo:{hasNextPage:false}}};
const json=data=>({ok:true,json:async()=>data});
async function performSync(){
 const pre=await invoke(sync,{...payload,dryRun:true});
 assert.equal(pre.data.ok,true);
 return invoke(sync,{...payload,preflightToken:pre.data.preflightToken});
}
async function invoke(handler,body={},method='POST',customHeaders=headers){
 const res={code:200,setHeader(){},status(code){this.code=code;return this},json(data){this.data=data;return this},end(){return this}};
 await handler({method,headers:customHeaders,body,query:body},res);return res;
}
function configure(t,fetcher){
 const previous={...process.env};Object.assign(process.env,env);delete process.env.CJ_ALLOW_REAL_SHOPIFY_ORDERS_IN_SANDBOX;
 t.after(()=>{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous)});
 t.mock.method(globalThis,'fetch',fetcher||(()=>{throw Error('Unexpected network request')}));
}
function mockStore({initial=null,currentOrder=order,uncertain=false,persistFail=false}={}){
 let state=initial,mutations=0,sets=0;const calls=[];
 const fetcher=async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;calls.push(body);
  if(String(url).startsWith('https://redis.invalid')){
   if(body[0]==='GET')return json({result:body[1].startsWith('ai-buyer:cj-sandbox:')?'created:CJ123':state});
   if(body[0]==='SET'){
    sets++;
    if(body.includes('NX')&&state!==null)return json({result:null});
    if(!body.includes('NX')&&persistFail)throw Error('Store unavailable');
    state=body[2];return json({result:'OK'});
   }
  }
  if(String(url).includes('/shopping/order/getOrderDetail'))return json({result:true,data:{orderId:'CJ123',isSandbox:1,trackNumber:'TRACK123'}});
  if(body.query.startsWith('query'))return json({data:{order:currentOrder}});
  if(body.query.startsWith('mutation')){
   mutations++;assert.equal(body.variables.fulfillment.notifyCustomer,false);
   if(uncertain)throw Error('Timed out after acceptance');
   return json({data:{fulfillmentCreate:{fulfillment:{id:'gid://shopify/Fulfillment/99',status:'SUCCESS'},userErrors:[]}}});
  }
  throw Error('Unexpected request');
 };
 return {fetcher,calls,get state(){return state},get mutations(){return mutations},get sets(){return sets}};
}
test('completed sync is recognized before closed fulfillment lookup',async t=>{
 const m=mockStore({initial:'synced:gid://shopify/Fulfillment/99'});configure(t,m.fetcher);
 const r=await invoke(sync,payload);assert.equal(r.code,200);assert.equal(r.data.duplicateConfirmed,true);assert.equal(m.calls.length,1);assert.equal(m.mutations,0);
});
for(const state of ['reserved','needs_review:unknown_shopify_result','unexpected'])test('unresolved state blocks writes: '+state,async t=>{
 const m=mockStore({initial:state});configure(t,m.fetcher);
 const r=await invoke(sync,payload);assert.equal(r.code,409);assert.equal(r.data.needsReview,true);assert.equal(r.data.ok,false);assert.equal(m.mutations,0);
});
test('duplicate verification without a record cannot write',async t=>{
 const m=mockStore();configure(t,m.fetcher);const r=await invoke(sync,{...payload,checkOnly:true});
 assert.equal(r.code,409);assert.equal(m.calls.length,1);assert.equal(m.sets,0);assert.equal(m.mutations,0);
});
test('dry-run writes neither Redis nor Shopify',async t=>{
 const m=mockStore();configure(t,m.fetcher);const r=await invoke(sync,{...payload,dryRun:true});
 assert.equal(r.data.eligible,true);assert.equal(m.sets,0);assert.equal(m.mutations,0);
});
for(const change of [{test:false},{cancelledAt:'2026-10-09'},{displayFinancialStatus:'REFUNDED'}])test('reject unsafe Shopify order '+JSON.stringify(change),async t=>{
 const m=mockStore({currentOrder:{...order,...change}});configure(t,m.fetcher);const r=await invoke(sync,payload);
 assert.equal(r.code,422);assert.equal(m.sets,0);assert.equal(m.mutations,0);
});
test('split fulfillment orders require review',async t=>{
 const m=mockStore({currentOrder:{...order,fulfillmentOrders:{nodes:[target,{...target,id:'other'}]}}});configure(t,m.fetcher);
 assert.equal((await invoke(sync,payload)).code,409);assert.equal(m.mutations,0);
});
test('successful sync persists completion and duplicate checks stay read-only',async t=>{
 const m=mockStore();configure(t,m.fetcher);assert.equal((await performSync()).data.ok,true);
 assert.equal(m.state,'synced:gid://shopify/Fulfillment/99');assert.equal((await invoke(sync,{...payload,checkOnly:true})).data.duplicateConfirmed,true);assert.equal(m.mutations,1);
});
for(const scenario of [{uncertain:true},{persistFail:true}])test('uncertain outcome never retries '+JSON.stringify(scenario),async t=>{
 const m=mockStore(scenario);configure(t,m.fetcher);const first=await performSync();
 assert.equal(first.data.needsReview,true);assert.equal(first.data.ok,false);
 assert.equal((await invoke(sync,payload)).code,409);assert.equal(m.mutations,1);
});
test('concurrent sync requests perform at most one mutation',async t=>{
 const m=mockStore();configure(t,m.fetcher);await Promise.all([performSync(),performSync()]);assert.equal(m.mutations,1);
});
test('authorization failure does not contact services',async t=>{
 configure(t);assert.equal((await invoke(sync,payload,'POST',{})).code,401);
 assert.equal((await invoke(sync,payload,'POST',{...headers,cookie:'shopify_access_token=x; shopify_connected_shop=attacker.invalid'})).code,403);
});
test('missing client ID and noninteger quantity limit fail release gate',async t=>{
 configure(t,async()=>json({result:'PONG'}));assert.equal((await invoke(readiness,{},'GET')).data.safeToTest,true);
 delete process.env.SHOPIFY_CLIENT_ID;let r=await invoke(readiness,{},'GET');assert.equal(r.data.safeToTest,false);assert.ok(r.data.blockers.includes('SHOPIFY_CLIENT_ID'));
 process.env.SHOPIFY_CLIENT_ID='test';process.env.CJ_MAX_ITEMS_PER_ORDER='1.5';assert.equal((await invoke(readiness,{},'GET')).data.safeToTest,false);
 process.env.CJ_MAX_ITEMS_PER_ORDER='10';process.env.CJ_SANDBOX_ORDER_ENABLED='false';r=await invoke(readiness,{},'GET');assert.ok(r.data.blockers.includes('CJ_SANDBOX_ORDER_ENABLED'));
});
test('real order webhook is rejected even with legacy override',async t=>{
 configure(t);process.env.CJ_ALLOW_REAL_SHOPIFY_ORDERS_IN_SANDBOX='true';
 const raw=Buffer.from(JSON.stringify({id:123,test:false,financial_status:'paid',currency:'USD',total_price:'10',line_items:[{sku:'variant123',quantity:1}]}));
 const req={method:'POST',headers:{'x-shopify-topic':'orders/paid','x-shopify-shop-domain':'test.myshopify.com','x-shopify-webhook-id':'test-event','x-shopify-hmac-sha256':crypto.createHmac('sha256','test-secret').update(raw).digest('base64')},async *[Symbol.asyncIterator](){yield raw}};
 const res={status(code){this.code=code;return this},json(data){this.data=data;return this}};
 await webhook(req,res);assert.equal(res.code,422);
});
test('webhook lookup reads later pages before deciding to create',async t=>{
 let reads=0;configure(t,async(url,opts)=>{const body=JSON.parse(opts.body);assert.ok(body.query.startsWith('query'));reads++;
 return json({data:{webhookSubscriptions:{nodes:reads===1?[{id:'old',topic:'ORDERS_PAID',uri:'https://old.invalid/api/shopify-order-webhook'}]:[{id:'correct',topic:'ORDERS_PAID',uri:'https://ai-buyer-nine.vercel.app/api/shopify-order-webhook'}],pageInfo:{hasNextPage:reads===1,endCursor:reads===1?'cursor':null}}}})});
 const r=await invoke(setup);assert.equal(reads,2);assert.equal(r.data.created,false);assert.equal(r.data.staleCount,1);
});
test('routers reject inherited object keys',async t=>{
 configure(t);for(const handler of [cj,diagnostics])for(const action of ['constructor','toString','__proto__'])assert.equal((await invoke(handler,{action},'GET')).code,404);
});
test('browser timestamps reject invalid, future and expired evidence',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const code=html.slice(html.indexOf('function testTimestampIsFresh('),html.indexOf('function releaseCheckIsFresh('));
 const context=vm.createContext({});vm.runInContext(code,context);const fresh=context.testTimestampIsFresh;
 assert.equal(fresh('broken'),false);assert.equal(fresh(new Date(Date.now()+60000).toISOString()),false);assert.equal(fresh(new Date(Date.now()-25*3600000).toISOString()),false);assert.equal(fresh(new Date().toISOString()),true);
});
test('all local API calls route to known files or declared rewrites',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 for(const [,path] of html.matchAll(/['"`]\/api\/([a-z-]+)/g)){
  assert.ok(fs.existsSync(new URL('../api/'+path+'.js',import.meta.url))||config.rewrites.some(r=>r.source==='/api/'+path),path);
 }
 assert.equal(fs.readdirSync(new URL('../api/',import.meta.url)).filter(f=>f.endsWith('.js')).length,8);
});
test('reconciliation batches reads, preserves cursor and exposes no raw keys',async t=>{
 const {default:reconcile}=await import('../lib/routes/automation-reconciliation.js');let count=0;
 configure(t,async(url,opts)=>{const cmd=JSON.parse(opts.body);count++;
  if(cmd[0]==='SCAN')return json({result:['42',['ai-buyer:fulfillment-sync:private1','ai-buyer:fulfillment-sync:private2']]});
  assert.equal(cmd[0],'MGET');return json({result:['needs_review:unknown_shopify_result','synced:gid://shopify/Fulfillment/99']});
 });
 const r=await invoke(reconcile,{kind:'fulfillment'},'GET');assert.equal(r.data.partial,true);assert.equal(r.data.nextCursor,'42');assert.equal(r.data.orders.length,1);assert.equal(r.data.orders[0].reason,'shopify_result_ambiguous');assert.equal(count,2);assert.equal(JSON.stringify(r.data).includes('private1'),false);
});
test('actual sync requires a fresh matching server preflight',async t=>{
 const m=mockStore();configure(t,m.fetcher);
 assert.equal((await invoke(sync,payload)).code,409);assert.equal(m.mutations,0);
 const pre=await invoke(sync,{...payload,dryRun:true});
 assert.equal((await invoke(sync,{...payload,preflightToken:pre.data.preflightToken.slice(0,-1)+'z'})).code,409);
 assert.equal(m.mutations,0);
});
test('client tracking must match linked sandbox CJ order',async t=>{
 const m=mockStore();configure(t,m.fetcher);
 const r=await invoke(sync,{...payload,trackingNumber:'WRONG',dryRun:true});assert.equal(r.code,409);assert.equal(m.mutations,0);
});
for(const sandboxFlag of [0,undefined])test('real or unconfirmed CJ orders cannot be synchronized '+sandboxFlag,async t=>{
 const m=mockStore();configure(t,async(url,opts)=>String(url).includes('/shopping/order/getOrderDetail')?json({result:true,data:{isSandbox:sandboxFlag,trackNumber:'TRACK123'}}):m.fetcher(url,opts));
 const r=await invoke(sync,{...payload,dryRun:true});assert.equal(r.data.ok,false);assert.equal(m.mutations,0);
});
