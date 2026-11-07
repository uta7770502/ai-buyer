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
