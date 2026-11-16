import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-risk.js';

test('CJ score-2 evidence failure reports safe score and remains fail-closed', async t => {
  const previous=process.env.CJ_ACCESS_TOKEN;
  process.env.CJ_ACCESS_TOKEN='test';
  t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
  t.mock.method(globalThis,'fetch',async url=>{
    const u=new URL(url);
    const score=u.searchParams.get('score');
    const data=u.pathname.endsWith('/product/query')?{pid:'p1',comprehensiveScore:4.9}:
      score==='2'?{total:'not-a-count'}:{total:20};
    return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>({result:true,data})};
  });
  const res={setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'GET',query:{id:'p1'}},res);
  assert.equal(res.statusCode,424);
  assert.equal(res.body.ok,false);
  assert.equal(res.body.stage,'review-score');
  assert.equal(res.body.reviewScore,2);
  assert.equal(res.body.diagnosticReason,'cj_review_score_total_invalid');
  assert.doesNotMatch(JSON.stringify(res.body),/not-a-count|CJ-Access-Token|test/);
});
