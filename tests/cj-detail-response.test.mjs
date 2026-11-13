import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-detail.js';
function mockCJFetch(t, implementation) {
 return t.mock.method(globalThis, 'fetch', async (...args) => {
  const response = await implementation(...args);
  return { ...response, headers: response.headers ?? { get: () => 'application/json' }, body: response.body ?? { cancel: async () => {} } };
 });
}
async function run(t,data){
 const previous=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
 mockCJFetch(t,async()=>({ok:true,json:async()=>({result:true,data})}));
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);return res;
}
test('detail rejects missing or mismatched supplier identities',async t=>{
 for(const data of [null,{},[],{pid:'product-2'}]){const res=await run(t,data);assert.equal(res.code,502);assert.notEqual(res.body.ok,true);}
});
test('detail reports an invalid auth response without exposing its body',async t=>{
 const previous=process.env.CJ_ACCESS_TOKEN;
 process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
 const fetchMock=mockCJFetch(t,async()=>({ok:false,status:401,json:async()=>{throw new Error('private supplier response');}}));
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);
 assert.equal(res.code,503);
 assert.equal(res.body.code,'CJ_DETAIL_AUTH_REJECTED');
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
 mockCJFetch(t,async()=>++calls===1
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
 mockCJFetch(t,async()=>{calls++;return {ok:false,status:502,json:async()=>({result:false})};});
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);
 assert.equal(calls,2);assert.equal(res.code,502);assert.equal(res.body.code,'CJ_DETAIL_HTTP_ERROR');
 assert.notEqual(res.body.ok,true);
});

test('CJ detail HTTP 403 is not retried and never exposes upstream body',async t=>{
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 let calls=0;
 mockCJFetch(t,async()=>{calls++;return {ok:false,status:403,json:async()=>({secret:'supplier-private'})};});
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
 mockCJFetch(t,async()=>{calls++;return {ok:true,status:200,json:async()=>{throw new Error('sensitive response');}};});
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);
 assert.equal(calls,1);assert.equal(res.code,502);
 assert.equal(res.body.code,'CJ_DETAIL_INVALID_JSON');
 assert.doesNotMatch(JSON.stringify(res.body),/sensitive response/);
});

test('CJ detail HTTP 429 does not retry and keeps supplier body private',async t=>{
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 let calls=0;
 mockCJFetch(t,async()=>{calls++;return {ok:false,status:429,json:async()=>({secret:'rate-limit-private'})};});
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);
 assert.equal(calls,1);assert.equal(res.code,502);
 assert.equal(res.body.code,'CJ_DETAIL_HTTP_ERROR');
 assert.doesNotMatch(JSON.stringify(res.body),/rate-limit-private/);
});
test('CJ detail HTTP 200 with supplier result false is never accepted',async t=>{
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 let calls=0;
 mockCJFetch(t,async()=>{calls++;return {ok:true,status:200,json:async()=>({result:false,data:{pid:'product-1'},message:'supplier-private'})};});
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);
 assert.equal(calls,1);assert.equal(res.code,502);
 assert.equal(res.body.code,'CJ_DETAIL_UPSTREAM_REJECTED');
 assert.doesNotMatch(JSON.stringify(res.body),/supplier-private/);
});


test('successful CJ detail responses explicitly disable caching of supplier quotes',async t=>{
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 mockCJFetch(t,async()=>({ok:true,status:200,json:async()=>({result:true,data:{pid:'product-1',variants:[{vid:'variant-1',variantSellPrice:'4.00',currency:'USD'}]}})}));
 const headers={};
 const res={setHeader(k,v){headers[k.toLowerCase()]=v},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);
 assert.equal(res.code,200);
 assert.equal(headers['cache-control'],'no-store');
 assert.equal(res.body.product.finalProfitVerified,false);
});


test('CJ detail rejects HTTP 200 HTML without parsing supplier body', async t => {
 const old = process.env.CJ_ACCESS_TOKEN; process.env.CJ_ACCESS_TOKEN = 'test';
 t.after(() => { if (old === undefined) delete process.env.CJ_ACCESS_TOKEN; else process.env.CJ_ACCESS_TOKEN = old; });
 let parsed = false;
 const fetchMock = mockCJFetch(t, async () => ({ ok: true, status: 200, headers: { get: () => 'text/html; charset=utf-8' }, json: async () => { parsed = true; throw new Error('private html'); } }));
 const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
 await handler({ method: 'GET', query: { id: 'product-1' } }, res);
 assert.equal(fetchMock.mock.callCount(), 1);
 assert.equal(parsed, false);
 assert.equal(res.code, 502);
 assert.equal(res.body.code, 'CJ_DETAIL_UNEXPECTED_CONTENT_TYPE');
 assert.doesNotMatch(JSON.stringify(res.body), /private html/);
});

test('CJ detail 502 followed by 429 stops after the single permitted retry', async t => {
 const old = process.env.CJ_ACCESS_TOKEN; process.env.CJ_ACCESS_TOKEN = 'test';
 t.after(() => { if (old === undefined) delete process.env.CJ_ACCESS_TOKEN; else process.env.CJ_ACCESS_TOKEN = old; });
 let calls = 0;
 mockCJFetch(t, async () => ({ ok: false, status: ++calls === 1 ? 502 : 429, json: async () => { throw new Error('private upstream error'); } }));
 const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
 await handler({ method: 'GET', query: { id: 'product-1' } }, res);
 assert.equal(calls, 2);
 assert.equal(res.code, 502);
 assert.equal(res.body.code, 'CJ_DETAIL_HTTP_ERROR');
 assert.equal(res.body.upstreamStatus, 429);
 assert.doesNotMatch(JSON.stringify(res.body), /private upstream error/);
});

test('CJ detail HTTP 500 retries once, then accepts only a matching supplier identity', async t => {
 const old = process.env.CJ_ACCESS_TOKEN; process.env.CJ_ACCESS_TOKEN = 'test';
 t.after(() => { if (old === undefined) delete process.env.CJ_ACCESS_TOKEN; else process.env.CJ_ACCESS_TOKEN = old; });
 let calls = 0;
 mockCJFetch(t, async () => ++calls === 1
   ? { ok: false, status: 500, json: async () => { throw new Error('supplier internal secret'); } }
   : { ok: true, status: 200, json: async () => ({ result: true, data: { pid: 'product-1' } }) });
 const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
 await handler({ method: 'GET', query: { id: 'product-1' } }, res);
 assert.equal(calls, 2);
 assert.equal(res.code, 200);
 assert.equal(res.body.product.id, 'product-1');
 assert.equal(res.body.product.finalProfitVerified, false);
 assert.doesNotMatch(JSON.stringify(res.body), /supplier internal secret/);
});

test('CJ detail HTTP 200 with missing content type fails closed without parsing', async t => {
 const old = process.env.CJ_ACCESS_TOKEN; process.env.CJ_ACCESS_TOKEN = 'test';
 t.after(() => { if (old === undefined) delete process.env.CJ_ACCESS_TOKEN; else process.env.CJ_ACCESS_TOKEN = old; });
 let parsed = false;
 const fetchMock = mockCJFetch(t, async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { parsed = true; return { result: true, data: { pid: 'product-1' } }; } }));
 const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
 await handler({ method: 'GET', query: { id: 'product-1' } }, res);
 assert.equal(fetchMock.mock.callCount(), 1);
 assert.equal(parsed, false);
 assert.equal(res.code, 502);
 assert.equal(res.body.code, 'CJ_DETAIL_UNEXPECTED_CONTENT_TYPE');
});

test('CJ detail rejects invalid identifiers before any supplier request', async t => {
 const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
 const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
 await handler({ method: 'GET', query: { id: '../unsafe' } }, res);
 assert.equal(res.code, 400);
 assert.equal(fetchMock.mock.callCount(), 0);
});

test('CJ detail HTTP 400 is not retried or treated as verified supplier data', async t => {
 const old = process.env.CJ_ACCESS_TOKEN; process.env.CJ_ACCESS_TOKEN = 'test';
 t.after(() => { if (old === undefined) delete process.env.CJ_ACCESS_TOKEN; else process.env.CJ_ACCESS_TOKEN = old; });
 const fetchMock = mockCJFetch(t, async () => ({ ok: false, status: 400, json: async () => { throw new Error('supplier-private'); } }));
 const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
 await handler({ method: 'GET', query: { id: 'product-1' } }, res);
 assert.equal(fetchMock.mock.callCount(), 1);
 assert.equal(res.code, 502);
 assert.equal(res.body.upstreamStatus, 400);
 assert.doesNotMatch(JSON.stringify(res.body), /supplier-private/);
});

test('CJ detail HTTP 503 retries once but remains fail-closed on a second 504', async t => {
 const old = process.env.CJ_ACCESS_TOKEN; process.env.CJ_ACCESS_TOKEN = 'test';
 t.after(() => { if (old === undefined) delete process.env.CJ_ACCESS_TOKEN; else process.env.CJ_ACCESS_TOKEN = old; });
 let calls = 0;
 mockCJFetch(t, async () => ({ ok: false, status: ++calls === 1 ? 503 : 504, json: async () => { throw new Error('supplier-private'); } }));
 const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
 await handler({ method: 'GET', query: { id: 'product-1' } }, res);
 assert.equal(calls, 2);
 assert.equal(res.code, 502);
 assert.equal(res.body.upstreamStatus, 504);
 assert.doesNotMatch(JSON.stringify(res.body), /supplier-private/);
});

test('CJ detail rejects padded and control-character auth tokens before supplier fetch', async t => {
 const previous = process.env.CJ_ACCESS_TOKEN;
 t.after(() => { if (previous === undefined) delete process.env.CJ_ACCESS_TOKEN; else process.env.CJ_ACCESS_TOKEN = previous; });
 const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('supplier must not be called'); });
 for (const token of [' test', 'test ', ...[9, 10, 13, 1, 31, 127].map(code => 'test' + String.fromCharCode(code) + 'value')]) {
   process.env.CJ_ACCESS_TOKEN = token;
   const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
   await handler({ method: 'GET', query: { id: 'product-1' } }, res);
   assert.equal(res.code, 503);
   assert.equal(res.body.code, 'CJ_DETAIL_AUTH_INVALID');
 }
 assert.equal(fetchMock.mock.callCount(), 0);
});

test('CJ detail rejects non-application +json media types before parsing', async t => {
 const old = process.env.CJ_ACCESS_TOKEN; process.env.CJ_ACCESS_TOKEN = 'test';
 t.after(() => { if (old === undefined) delete process.env.CJ_ACCESS_TOKEN; else process.env.CJ_ACCESS_TOKEN = old; });
 let parsed = false;
 const fetchMock = mockCJFetch(t, async () => ({
   ok: true, status: 200,
   headers: { get: () => 'text/vendor+json; charset=utf-8' },
   json: async () => { parsed = true; return { result: true, data: { pid: 'product-1' } }; }
 }));
 const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
 await handler({ method: 'GET', query: { id: 'product-1' } }, res);
 assert.equal(fetchMock.mock.callCount(), 1);
 assert.equal(parsed, false);
 assert.equal(res.code, 502);
 assert.equal(res.body.code, 'CJ_DETAIL_UNEXPECTED_CONTENT_TYPE');
});

for (const mediaType of ['application/+json', 'application/jsonp', 'application/.vendor+json']) {
  test(`CJ detail rejects malformed media type ${mediaType} without parsing`, async t => {
    const old = process.env.CJ_ACCESS_TOKEN; process.env.CJ_ACCESS_TOKEN = 'test';
    t.after(() => { if (old === undefined) delete process.env.CJ_ACCESS_TOKEN; else process.env.CJ_ACCESS_TOKEN = old; });
    let parsed = false;
    const fetchMock = mockCJFetch(t, async () => ({
      ok: true, status: 200, headers: { get: () => mediaType },
      json: async () => { parsed = true; throw new Error('PRIVATE_SUPPLIER_BODY'); }
    }));
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'GET', query: { id: 'product-1' } }, res);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(parsed, false);
    assert.equal(res.code, 502);
    assert.equal(res.body.code, 'CJ_DETAIL_UNEXPECTED_CONTENT_TYPE');
    assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE_SUPPLIER_BODY/);
  });
}
