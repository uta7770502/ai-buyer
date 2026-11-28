import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-risk.js';

function safeReviews(count=10, scores=[]) {
  return {total:count,list:Array.from({length:count},(_,i)=>({score:String(scores[i]??5)}))};
}
async function run(t,{mismatch=false,fail=false,reviewEnvelope={},contentType='application/json',reviews=safeReviews()}={}) {
  const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
  t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
  const signals=[];
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    signals.push(opts.signal);
    if(fail)throw Error('secret upstream detail');
    const u=new URL(url);
    const detail=u.pathname.endsWith('/product/query');
    const data=detail?{pid:mismatch?'other':'p1',comprehensiveScore:4.5}:reviews;
    const body=detail?{result:true,data}:{success:true,code:0,data,...reviewEnvelope};
    return {ok:true,status:200,headers:contentType===null?new Headers():new Headers({'content-type':contentType}),body:{cancel:async()=>{}},json:async()=>body};
  });
  const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
  await handler({method:'GET',query:{id:'p1'}},res);
  return {res,signals};
}

test('review evidence requires matching product and a shared request deadline',async t=>{
 const {res,signals}=await run(t);
 assert.equal(res.code,200);
 assert.equal(res.body.risk.exclude,false);
 assert.equal(res.body.risk.reviewCount,10);
 assert.equal(signals.length,2);
 assert.ok(signals.every(s=>s instanceof AbortSignal&&s===signals[0]));
});

test('mismatched product cannot produce a safe review result',async t=>{
 const {res,signals}=await run(t,{mismatch:true});
 assert.equal(res.body.ok,false);
 assert.equal(signals.length,1);
});

test('documented review list provides exact low-star counts',async t=>{
 const {res}=await run(t,{reviews:safeReviews(20,[1,2,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5])});
 assert.equal(res.code,200);
 assert.equal(res.body.risk.reviewCount,20);
 assert.equal(res.body.risk.lowReviews,1);
 assert.equal(res.body.risk.twoStarReviews,1);
 assert.equal(res.body.risk.exclude,true);
});

test('incomplete review pagination cannot authorize recommendation',async t=>{
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 t.mock.method(globalThis,'fetch',async url=>{
  const u=new URL(url);
  const detail=u.pathname.endsWith('/product/query');
  if(detail)return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:{cancel:async()=>{}},json:async()=>({result:true,data:{pid:'p1',comprehensiveScore:4.5}})};
  const page=Number(u.searchParams.get('pageNum')||1);
  const data=page===1?{total:20,pageSize:10,list:Array.from({length:10},()=>({score:'5'}))}:{total:20,pageSize:10,list:[]};
  return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:{cancel:async()=>{}},json:async()=>({success:true,code:0,data})};
 });
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'p1'}},res);
 assert.equal(res.code,424);
 assert.equal(res.body.code,'CJ_REVIEW_EVIDENCE_UNAVAILABLE');
 assert.equal(res.body.diagnosticReason,'cj_review_page_incomplete');
});

test('invalid review score cannot authorize recommendation',async t=>{
 const {res}=await run(t,{reviews:{total:10,list:[{score:'0'},...Array.from({length:9},()=>({score:'5'}))]}});
 assert.equal(res.code,424);
 assert.equal(res.body.diagnosticReason,'cj_review_item_score_invalid');
});

test('explicit review rejection takes precedence over success field',async t=>{
 const {res}=await run(t,{reviewEnvelope:{result:false}});
 assert.equal(res.code,502);
 assert.equal(res.body.code,'CJ_REVIEWS_UPSTREAM_REJECTED');
});

test('review transport failures remain failures without exposing upstream messages',async t=>{
 const {res}=await run(t,{fail:true});
 assert.equal(res.body.ok,false);
 assert.match(res.body.error,/推薦を保留/);
 assert.doesNotMatch(res.body.error,/secret/);
});

test('detail and reviews upstream failures identify their stage',async t=>{
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 for(const stage of ['detail','reviews']){
  const mock=t.mock.method(globalThis,'fetch',async url=>{
   const detail=new URL(url).pathname.endsWith('/product/query');
   const actual=detail?'detail':'reviews';
   if(actual===stage)return {ok:false,status:502,headers:new Headers(),body:{cancel:async()=>{}},json:async()=>({message:'private'})};
   return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:{cancel:async()=>{}},json:async()=>detail?{result:true,data:{pid:'p1',comprehensiveScore:4.5}}:{success:true,code:0,data:safeReviews()}};
  });
  const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
  await handler({method:'GET',query:{id:'p1'}},res);
  assert.equal(res.code,502);
  assert.equal(res.body.upstreamStatus,502);
  assert.equal(res.body.code,stage==='detail'?'CJ_DETAIL_UPSTREAM_REJECTED':'CJ_REVIEWS_UPSTREAM_REJECTED');
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
  mock.mock.restore();
 }
});

test('explicit HTML response cannot be accepted as verified CJ review evidence', async t => {
 const {res}=await run(t,{contentType:'text/html; charset=utf-8'});
 assert.equal(res.code,502);
 assert.equal(res.body.ok,false);
});

test('missing CJ response content type blocks review evidence', async t => {
 const {res,signals}=await run(t,{contentType:null});
 assert.equal(res.code,502);
 assert.equal(res.body.ok,false);
 assert.equal(signals.length,1);
});
