import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/automation-order-status.js';
async function read(t,data){
 const old={...process.env};Object.assign(process.env,{VERCEL_ENV:'test',AI_BUYER_ADMIN_KEY:'test',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',UPSTASH_REDIS_REST_URL:'https://redis.invalid',UPSTASH_REDIS_REST_TOKEN:'test'});
 t.after(()=>{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old)});
 t.mock.method(globalThis,'fetch',async(url,opts)=>{assert.equal(JSON.parse(opts.body)[0],'GET');return {ok:true,json:async()=>data}});
 const res={code:200,setHeader(){},status(code){this.code=code;return this},json(body){this.body=body}};
 await handler({method:'GET',headers:{authorization:'Bearer test'},query:{orderId:'123'}},res);return res;
}
for(const result of ['created:','created:bad secret','not_found',{},42,''])test('malformed saved order requires review '+JSON.stringify(result),async t=>{
 const r=await read(t,{result});assert.equal(r.code,200);assert.equal(r.body.status,'unknown');assert.equal(r.body.needsReview,true);assert.equal(r.body.cjOrderId,null);assert.equal(r.body.automaticRetry,false);
});
test('missing Redis result is unavailable, not absent',async t=>{const r=await read(t,{});assert.equal(r.code,503);assert.equal(r.body.ok,false)});
test('null Redis result is absent',async t=>{const r=await read(t,{result:null});assert.equal(r.body.status,'not_found');assert.equal(r.body.needsReview,false)});
test('valid saved CJ reference remains readable',async t=>{const r=await read(t,{result:'created:CJ-123'});assert.equal(r.body.status,'sandbox_created');assert.equal(r.body.cjOrderId,'CJ-123');assert.equal(r.body.needsReview,false)});
