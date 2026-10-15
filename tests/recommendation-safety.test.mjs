import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import handler from '../lib/routes/cj-search.js';

test('CJ trending search sends trending and listing floor parameters',async t=>{
  const old=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test-token';
  t.after(()=>{if(old===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=old});
  let called='';
  t.mock.method(globalThis,'fetch',async url=>{
    called=String(url);
    return {ok:true,json:async()=>({result:true,data:{content:[{productList:[{id:'p1',nameEn:'Safe item',sellPrice:'10',listedNum:55,productType:'0',saleStatus:'3',totalVerifiedInventory:80}]}],totalRecords:1,totalPages:1}})};
  });
  const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v;return this}};
  await handler({method:'GET',query:{q:'home',page:'1',size:'20',trending:'1',minListed:'30'}},res);
  assert.equal(res.code,200);
  const u=new URL(called);
  assert.equal(u.searchParams.get('searchType'),'2');
  assert.equal(u.searchParams.get('orderBy'),'listedNum');
  assert.equal(u.searchParams.get('minListedNum'),'30');
  assert.equal(res.body.products[0].trending,true);
  assert.equal(res.body.products[0].productType,'0');
});

test('AI recommendation gate requires trending, listing evidence and safe product type',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/SAFE_TREND_MIN_LISTINGS=30/);
  assert.match(html,/Boolean\(p\.trending\)/);
  assert.match(html,/\['1','3','5'\]\.includes/);
  assert.match(html,/安全性/);
  assert.match(html,/trending=1&minListed=/);
});
