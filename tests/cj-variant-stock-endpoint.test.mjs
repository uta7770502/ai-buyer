import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-variant-stock.js';

const makeResponse=()=>({
 statusCode:200,headers:{},body:null,
 setHeader(k,v){this.headers[k]=v;return this;},
 status(n){this.statusCode=n;return this;},
 json(v){this.body=v;return this;}
});
const warehouse=(cj,factory)=>({result:true,data:[{cjInventoryNum:cj,factoryInventoryNum:factory,totalInventoryNum:cj+factory}]});

test('CJ variant endpoint separates factory recommendation from immediate launch stock',async()=>{
 const originalFetch=globalThis.fetch;
 const originalToken=process.env.CJ_ACCESS_TOKEN;
 const originalKey=process.env.CJ_API_KEY;
 process.env.CJ_ACCESS_TOKEN='test-token';
 delete process.env.CJ_API_KEY;
 try{
  for(const [cj,factory,eligible,replenishment,launch] of [[0,5,true,true,false],[2,3,true,true,false],[5,0,true,false,true],[2,2,false,false,false]]){
   globalThis.fetch=async()=>({ok:true,status:200,json:async()=>warehouse(cj,factory)});
   const res=makeResponse();
   await handler({method:'GET',query:{vid:'1657322876615274496'}},res);
   assert.equal(res.statusCode,200);
   assert.equal(res.body.readOnly,true);
   assert.equal(res.body.verifiedInventory,cj);
   assert.equal(res.body.factoryStockQuantity,factory);
   assert.equal(res.body.recommendationStockEligible,eligible);
   assert.equal(res.body.requiresFactoryReplenishment,replenishment);
   assert.equal(res.body.launchEligible,launch);
   assert.equal(res.body.minimumLaunchInventory,5);
  }
 }finally{
  globalThis.fetch=originalFetch;
  if(originalToken===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=originalToken;
  if(originalKey===undefined)delete process.env.CJ_API_KEY;else process.env.CJ_API_KEY=originalKey;
 }
});

test('CJ variant endpoint rejects unknown inventory instead of reporting zero',async()=>{
 const originalFetch=globalThis.fetch;
 const originalToken=process.env.CJ_ACCESS_TOKEN;
 const originalKey=process.env.CJ_API_KEY;
 process.env.CJ_ACCESS_TOKEN='test-token';
 delete process.env.CJ_API_KEY;
 globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({result:false,data:[]})});
 try{
  const res=makeResponse();
  await handler({method:'GET',query:{vid:'1657322876615274496'}},res);
  assert.equal(res.statusCode,409);
  assert.equal(res.body.ok,false);
  assert.equal(res.body.inventoryVerified,false);
 }finally{
  globalThis.fetch=originalFetch;
  if(originalToken===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=originalToken;
  if(originalKey===undefined)delete process.env.CJ_API_KEY;else process.env.CJ_API_KEY=originalKey;
 }
});

test('CJ variant endpoint rejects invalid IDs and write methods without contacting supplier',async()=>{
 const originalFetch=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('unexpected CJ request')};
 try{
  for(const req of [
   {method:'POST',query:{vid:'1657322876615274496'}},
   {method:'GET',query:{vid:'not-a-vid'}},
   {method:'GET',query:{vid:'1657322876615274496&apply=true'}}
  ]){
   const res=makeResponse();
   await handler(req,res);
   assert.equal(res.body.ok,false);
   assert.ok([400,405].includes(res.statusCode));
  }
  assert.equal(calls,0);
 }finally{globalThis.fetch=originalFetch}
});

test('CJ variant endpoint fails closed on rate limit, authorization, HTTP errors and network failure',async()=>{
 const originalFetch=globalThis.fetch;
 const originalToken=process.env.CJ_ACCESS_TOKEN;
 const originalKey=process.env.CJ_API_KEY;
 process.env.CJ_ACCESS_TOKEN='test-token';
 delete process.env.CJ_API_KEY;
 try{
  for(const [upstream,expected,code] of [[429,429,'CJ_STOCK_RATE_LIMITED'],[401,503,'CJ_STOCK_AUTH_REJECTED'],[403,503,'CJ_STOCK_AUTH_REJECTED'],[500,503,'CJ_STOCK_UPSTREAM_HTTP_ERROR']]){
   globalThis.fetch=async()=>({ok:false,status:upstream,json:async()=>({})});
   const res=makeResponse();
   await handler({method:'GET',query:{vid:'1657322876615274496'}},res);
   assert.equal(res.statusCode,expected);
   assert.equal(res.body.ok,false);
   assert.equal(res.body.code,code);
   assert.equal(res.body.launchEligible,undefined);
  }
  globalThis.fetch=async()=>{throw Error('network unavailable')};
  const res=makeResponse();
  await handler({method:'GET',query:{vid:'1657322876615274496'}},res);
  assert.equal(res.statusCode,503);
  assert.equal(res.body.ok,false);
  assert.equal(res.body.verifiedInventory,undefined);
 }finally{
  globalThis.fetch=originalFetch;
  if(originalToken===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=originalToken;
  if(originalKey===undefined)delete process.env.CJ_API_KEY;else process.env.CJ_API_KEY=originalKey;
 }
});
