import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-detail.js';
async function run(t,data){
 const previous=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({result:true,data})}));
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);return res;
}
test('detail rejects missing or mismatched supplier identities',async t=>{
 for(const data of [null,{},[],{pid:'product-2'}]){const res=await run(t,data);assert.equal(res.code,502);assert.notEqual(res.body.ok,true);}
});
test('detail reports an invalid auth response without exposing its body',async t=>{
 const previous=process.env.CJ_API_KEY;
 process.env.CJ_API_KEY='test';
 t.after(()=>{if(previous===undefined)delete process.env.CJ_API_KEY;else process.env.CJ_API_KEY=previous;});
 const fetchMock=t.mock.method(globalThis,'fetch',async()=>({ok:false,status:401,json:async()=>{throw new Error('private supplier response');}}));
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);
 assert.equal(res.code,503);
 assert.equal(res.body.code,'CJ_DETAIL_AUTH_FAILED');
 assert.equal(res.body.upstreamStatus,401);
 assert.doesNotMatch(JSON.stringify(res.body),/private supplier response/);
 assert.equal(fetchMock.mock.callCount(),1);
});
test('detail keeps absent listing counts unknown and actual zero intact',async t=>{
 let res=await run(t,{pid:'product-1',sellPrice:3});assert.equal(res.code,200);assert.equal(res.body.product.listedNum,null);
 res=await run(t,{pid:'product-1',listedNum:0});assert.equal(res.body.product.listedNum,0);
});

test('CJ variant quotes are never promoted to settled supplier costs',async t=>{
 const res=await run(t,{pid:'product-1',variants:[{vid:'1234567890123',variantSellPrice:'3.25',currency:'USD'},{vid:'1234567890124',variantSellPrice:'2.50'}]});
 assert.equal(res.code,200);
 assert.equal(res.body.product.quoteEvidence[0].quoteCurrencyVerified,true);
 assert.equal(res.body.product.quoteEvidence[0].quotedAmount,3.25);
 assert.equal(res.body.product.quoteEvidence[1].quoteCurrencyVerified,false);
 assert.equal(res.body.product.quoteEvidence[1].currency,null);
 assert.equal(res.body.product.settledSupplierCostVerified,false);
 assert.equal(res.body.product.finalProfitVerified,false);
 assert.ok(res.body.product.quoteEvidence.every(x=>x.settledCostVerified===false&&x.finalProfitVerified===false));
});

test('transient CJ detail HTTP 502 retries once and returns verified matching identity',async t=>{
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>++calls===1
   ? {ok:false,status:502,json:async()=>({result:false})}
   : {ok:true,status:200,json:async()=>({result:true,data:{pid:'product-1'}})});
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);
 assert.equal(calls,2);assert.equal(res.code,200);assert.equal(res.body.product.id,'product-1');
 assert.equal(res.body.product.finalProfitVerified,false);
});
test('persistent CJ detail HTTP 502 fails closed after exactly two attempts',async t=>{
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return {ok:false,status:502,json:async()=>({result:false})};});
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);
 assert.equal(calls,2);assert.equal(res.code,502);assert.equal(res.body.code,'CJ_DETAIL_HTTP_ERROR');
 assert.notEqual(res.body.ok,true);
});

test('CJ detail HTTP 403 is not retried and never exposes upstream body',async t=>{
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return {ok:false,status:403,json:async()=>({secret:'supplier-private'})};});
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);
 assert.equal(calls,1);assert.equal(res.code,503);
 assert.equal(res.body.code,'CJ_DETAIL_AUTH_REJECTED');
 assert.doesNotMatch(JSON.stringify(res.body),/supplier-private/);
});
test('CJ detail HTTP 200 with malformed JSON fails closed without retry',async t=>{
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return {ok:true,status:200,json:async()=>{throw new Error('sensitive response');}};});
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);
 assert.equal(calls,1);assert.equal(res.code,502);
 assert.equal(res.body.code,'CJ_DETAIL_INVALID_JSON');
 assert.doesNotMatch(JSON.stringify(res.body),/sensitive response/);
});
