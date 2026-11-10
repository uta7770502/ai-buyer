import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-risk.js';
async function run(t,{mismatch=false,fail=false}={}){
 const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old;});
 const signals=[];
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  signals.push(opts.signal);if(fail)throw Error('secret upstream detail');
  const u=new URL(url);const data=u.pathname.endsWith('/product/query')?{pid:mismatch?'other':'p1',comprehensiveScore:4.5}: {total:u.searchParams.has('score')?0:100};
  return {ok:true,json:async()=>({result:true,data})};
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
   return {ok:true,status:200,json:async()=>({result:true,data:actual==='detail'?{pid:'p1',comprehensiveScore:4.5}:{total:10}})};
  });
  const response=res();await handler({method:'GET',query:{id:'p1'}},response);
  assert.equal(response.code,502);assert.equal(response.body.ok,false);
  assert.equal(response.body.upstreamStatus,502);
  assert.equal(response.body.code,({detail:'CJ_DETAIL_UPSTREAM_REJECTED',reviews:'CJ_REVIEWS_UPSTREAM_REJECTED','review-score':'CJ_REVIEW_SCORE_UPSTREAM_REJECTED'})[stage]);
  assert.doesNotMatch(JSON.stringify(response.body),/private supplier error/);
  mock.mock.restore();
 }
});
