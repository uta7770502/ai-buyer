import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-risk.js';
async function run(t,{mismatch=false,fail=false,documentedReviews=false,scoreTotal='0',reviewEnvelope={},rateLimited=false,contentType='application/json'}={}){
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 const signals=[];
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  signals.push(opts.signal);if(fail)throw Error('secret upstream detail');
  const u=new URL(url);const data=u.pathname.endsWith('/product/query')?{pid:mismatch?'other':'p1',comprehensiveScore:4.5}: {total:u.searchParams.has('score')?0:100};
  if(rateLimited && u.searchParams.get('score')==='1' && signals.length===3){
   return {ok:false,status:429,headers:new Headers({'Retry-After':'0'})};
  }
  const body = documentedReviews && u.pathname.endsWith('/productComments')
   ? {success:true,code:0,data:{total:u.searchParams.has('score')?scoreTotal:'100'},...reviewEnvelope}
   : {result:true,data};
  return {ok:true,headers:contentType===null?new Headers():new Headers({'content-type':contentType}),json:async()=>body};
 });
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'p1'}},res);return {res,signals};
}
test('review evidence requires matching product and a shared request deadline',async t=>{
 const {res,signals}=await run(t);assert.equal(res.code,200);assert.equal(res.body.risk.exclude,false);assert.equal(res.body.risk.reviewCount,100);assert.equal(signals.length,4);assert.ok(signals.every(s=>s instanceof AbortSignal&&s===signals[0]));
});
test('mismatched product cannot produce a safe review result',async t=>{
 const {res,signals}=await run(t,{mismatch:true});assert.equal(res.body.ok,false);assert.equal(signals.length,1);
});
test('CJ documented review envelope provides verified counts',async t=>{
 const {res}=await run(t,{documentedReviews:true});
 assert.equal(res.code,200);
 assert.equal(res.body.risk.reviewCount,100);
 assert.equal(res.body.risk.exclude,false);
});
test('a transient CJ score rate limit is retried within the shared deadline',async t=>{
 const {res,signals}=await run(t,{rateLimited:true});
 assert.equal(res.code,200);
 assert.equal(res.body.risk.exclude,false);
 assert.equal(signals.length,5);
 assert.ok(signals.every(signal=>signal===signals[0]));
});
test('empty score counts cannot be treated as zero',async t=>{
 const {res}=await run(t,{documentedReviews:true,scoreTotal:''});
 assert.equal(res.code,424);
 assert.equal(res.body.code,'CJ_REVIEW_EVIDENCE_UNAVAILABLE');
});
test('explicit review rejection takes precedence over the success field',async t=>{
 const {res}=await run(t,{documentedReviews:true,reviewEnvelope:{result:false}});
 assert.equal(res.code,502);
 assert.equal(res.body.code,'CJ_REVIEWS_UPSTREAM_REJECTED');
});
test('review transport failures remain failures without exposing upstream messages',async t=>{
 const {res}=await run(t,{fail:true});assert.equal(res.body.ok,false);assert.match(res.body.error,/推薦を保留/);assert.doesNotMatch(res.body.error,/secret/);
});

test('upstream detail and review failures identify their stage without bypassing review gate',async t=>{
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 const res=()=>({setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}});
 for(const stage of ['detail','reviews','review-score']){
  const mock=t.mock.method(globalThis,'fetch',async url=>{
   const u=new URL(url);
   const actual=u.pathname.endsWith('/product/query')?'detail':u.searchParams.has('score')?'review-score':'reviews';
   if(actual===stage)return {ok:false,status:502,json:async()=>({message:'private supplier error'})};
   return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>({result:true,data:actual==='detail'?{pid:'p1',comprehensiveScore:4.5}:{total:10}})};
  });
  const response=res();await handler({method:'GET',query:{id:'p1'}},response);
  assert.equal(response.code,502);assert.equal(response.body.ok,false);
  assert.equal(response.body.upstreamStatus,502);
  assert.equal(response.body.code,({detail:'CJ_DETAIL_UPSTREAM_REJECTED',reviews:'CJ_REVIEWS_UPSTREAM_REJECTED','review-score':'CJ_REVIEW_SCORE_UPSTREAM_REJECTED'})[stage]);
  assert.doesNotMatch(JSON.stringify(response.body),/private supplier error/);
  mock.mock.restore();
 }
});

test('malformed CJ review credentials fail closed without an upstream request', async t => {
 const previous=process.env.CJ_ACCESS_TOKEN;
 t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
 for(const invalid of [' leading','trailing ','bad\nline','bad\ttab','bad\rreturn','bad\x7fdel']){
  process.env.CJ_ACCESS_TOKEN=invalid;
  let calls=0;
  const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('unexpected CJ request');});
  const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
  await handler({method:'GET',query:{id:'p1'}},res);
  assert.equal(res.code,503);
  assert.equal(res.body.code,'CJ_AUTH_INVALID');
  assert.equal(calls,0);
  assert.doesNotMatch(JSON.stringify(res.body),/leading|trailing|bad\\nline/);
  mock.mock.restore();
 }
});

test('explicit HTML response cannot be accepted as verified CJ review evidence', async t => {
 const {res}=await run(t,{contentType:'text/html; charset=utf-8'});
 assert.equal(res.code,502);
 assert.equal(res.body.ok,false);
 assert.equal(res.body.code,'CJ_DETAIL_UPSTREAM_REJECTED');
 assert.match(res.body.error,/推薦を保留/);
});

// An HTTP 200 without an explicit JSON media type must never authorize reviews.
test('missing CJ response content type blocks review evidence without parsing', async t => {
 const {res,signals}=await run(t,{contentType:null});
 assert.equal(res.code,502);
 assert.equal(res.body.ok,false);
 assert.equal(res.body.code,'CJ_DETAIL_UPSTREAM_REJECTED');
 assert.equal(signals.length,1);
 assert.match(res.body.error,/推薦を保留/);
});

test('CJ gateway 502 followed by auth 401 stops after two attempts and fails closed', async t => {
 // Force the static-token path: CJ_API_KEY takes precedence and would add an auth fetch.
 const previous=process.env.CJ_ACCESS_TOKEN;
 const previousKey=process.env.CJ_API_KEY;
 delete process.env.CJ_API_KEY;
 process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{
  if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;
  if(previousKey===undefined)delete process.env.CJ_API_KEY;else process.env.CJ_API_KEY=previousKey;
 });
 const requestPaths=[];
 t.mock.method(globalThis,'fetch',async url=>{
  const path=new URL(url).pathname;
  requestPaths.push(path);
  const detailAttempts=requestPaths.filter(value=>value.endsWith('/product/query')).length;
  return {ok:false,status:detailAttempts===1?502:401,headers:new Headers(),body:{cancel:async()=>{}},json:async()=>{throw Error('must not parse private upstream error');}};
 });
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'p1'}},res);
 // An earlier concurrent review-score request can finish after its test returns.
 // Count only this scenario's detail attempts; unrelated in-flight review calls
 // must not be mistaken for an extra authentication or detail retry.
 assert.deepEqual(requestPaths.filter(path=>path.endsWith('/product/query')), [
  '/api2.0/v1/product/query',
  '/api2.0/v1/product/query'
 ]);
 assert.equal(res.code,503);
 assert.equal(res.body.code,'CJ_AUTH_REJECTED');
 assert.equal(res.body.upstreamStatus,401);
 assert.match(res.body.error,/推薦を保留/);
});

test('CJ gateway 502 followed by 429 never triggers a third request', async t => {
 const previous=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{
  calls++;
  return {ok:false,status:calls===1?502:429,headers:new Headers({'Retry-After':'0'}),body:{cancel:async()=>{}},json:async()=>{throw Error('must not parse private upstream error');}};
 });
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'p1'}},res);
 assert.equal(calls,2);
 assert.equal(res.code,502);
 assert.equal(res.body.code,'CJ_DETAIL_UPSTREAM_REJECTED');
 assert.equal(res.body.upstreamStatus,429);
});

test('CJ rate limit with excessive Retry-After fails closed without sleeping or retrying', async t => {
 const previous=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{
  calls++;
  return {ok:false,status:429,headers:new Headers({'Retry-After':'120'}),body:{cancel:async()=>{}},json:async()=>{throw Error('private upstream diagnostics');}};
 });
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'p1'}},res);
 assert.equal(calls,1);
 assert.equal(res.code,502);
 assert.equal(res.body.code,'CJ_DETAIL_UPSTREAM_REJECTED');
 assert.equal(res.body.upstreamStatus,429);
 assert.doesNotMatch(JSON.stringify(res.body),/private upstream diagnostics/);
});

test('CJ rate limit with invalid Retry-After fails closed without retry', async t => {
 const previous=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{
  calls++;
  return {ok:false,status:429,headers:new Headers({'Retry-After':'not-a-date'}),body:{cancel:async()=>{}},json:async()=>{throw Error('private upstream diagnostics');}};
 });
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'p1'}},res);
 assert.equal(calls,1);
 assert.equal(res.code,502);
 assert.equal(res.body.code,'CJ_DETAIL_UPSTREAM_REJECTED');
 assert.equal(res.body.upstreamStatus,429);
 assert.match(res.body.error,/推薦を保留/);
});

test('CJ detail 500 twice stops at two attempts and never parses private diagnostics', async t => {
 const previous=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{
  calls++;
  return {ok:false,status:500,headers:new Headers(),body:{cancel:async()=>{}},json:async()=>{throw Error('private upstream diagnostics');}};
 });
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'p1'}},res);
 assert.equal(calls,2);
 assert.equal(res.code,502);
 assert.equal(res.body.code,'CJ_DETAIL_UPSTREAM_REJECTED');
 assert.equal(res.body.upstreamStatus,500);
 assert.doesNotMatch(JSON.stringify(res.body),/private upstream diagnostics/);
});

test('CJ reviews 500 twice cannot authorize recommendation despite valid detail', async t => {
 const previous=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
 let detailCalls=0,reviewCalls=0;
 t.mock.method(globalThis,'fetch',async url=>{
  if(new URL(url).pathname.endsWith('/product/query')){
   detailCalls++;
   return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>({result:true,data:{pid:'p1',comprehensiveScore:4.8}})};
  }
  reviewCalls++;
  return {ok:false,status:500,headers:new Headers(),body:{cancel:async()=>{}},json:async()=>{throw Error('private review diagnostics');}};
 });
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'p1'}},res);
 assert.equal(detailCalls,1);
 assert.equal(reviewCalls,2);
 assert.equal(res.code,502);
 assert.equal(res.body.code,'CJ_REVIEWS_UPSTREAM_REJECTED');
 assert.equal(res.body.upstreamStatus,500);
 assert.doesNotMatch(JSON.stringify(res.body),/private review diagnostics/);
});


test('unexpected CJ review envelope reports safe schema diagnostic without granting recommendation', async t => {
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 t.mock.method(globalThis,'fetch',async url=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>new URL(url).pathname.endsWith('/product/query')?{result:true,data:{pid:'p1',comprehensiveScore:4.8}}:{success:true,code:'200',data:{total:20,privateMessage:'SECRET'}}}));
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'p1'}},res);
 assert.equal(res.code,502);
 assert.equal(res.body.ok,false);
 assert.equal(res.body.stage,'reviews');
 assert.equal(res.body.diagnosticReason,'cj_response_envelope_unrecognized');
 assert.doesNotMatch(JSON.stringify(res.body),/SECRET/);
});

test('malformed CJ review JSON is safely classified and blocks recommendation', async t => {
 const previous=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
 t.mock.method(globalThis,'fetch',async url=>({
  ok:true,status:200,headers:new Headers({'content-type':'application/json'}),
  json:async()=>{if(new URL(url).pathname.endsWith('/product/query'))return {result:true,data:{pid:'p1',comprehensiveScore:4.7}};throw Error('PRIVATE_INVALID_JSON');}
 }));
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'p1'}},res);
 assert.equal(res.code,502);
 assert.equal(res.body.stage,'reviews');
 assert.equal(res.body.diagnosticReason,'cj_response_json_invalid');
 assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE_INVALID_JSON/);
});

test('CJ review HTML is classified without exposing upstream body', async t => {
 const previous=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
 t.mock.method(globalThis,'fetch',async url=>{
  const detail=new URL(url).pathname.endsWith('/product/query');
  return {ok:true,status:200,headers:new Headers({'content-type':detail?'application/json':'text/html'}),json:async()=>detail?{result:true,data:{pid:'p1',comprehensiveScore:4.7}}:({private:'SECRET'})};
 });
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'p1'}},res);
 assert.equal(res.code,502);
 assert.equal(res.body.stage,'reviews');
 assert.equal(res.body.diagnosticReason,'cj_response_media_type_invalid');
 assert.doesNotMatch(JSON.stringify(res.body),/SECRET/);
});
