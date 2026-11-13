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
