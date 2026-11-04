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
  assert.equal(u.searchParams.get('productFlag'),'0');
  assert.equal(u.searchParams.get('orderBy'),'1');
  assert.equal(u.searchParams.get('sort'),'desc');
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

test('publication gate rechecks demand, product type and verified inventory',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('function launchEligibility(');
  const end=html.indexOf('function scaleEligibility(',start);
  const block=html.slice(start,end);
  assert.match(block,/x\.trending!==true/);
  assert.match(block,/listed<SAFE_TREND_MIN_LISTINGS/);
  assert.match(block,/\['1','3','5'\]\.includes/);
  assert.match(block,/inventory<=20/);
  assert.match(block,/CJ Trending未確認/);
  assert.match(block,/検証済み在庫が少ない/);
});

test('market monitor blocks launch on supplier suspension price spike delay and unknown state',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const evalStart=html.indexOf('function evaluateMonitor(');
  const evalEnd=html.indexOf('function renderMonitor(',evalStart);
  const monitor=html.slice(evalStart,evalEnd);
  assert.match(monitor,/kind:'販売停止'/);
  assert.match(monitor,/kind:'価格急騰'/);
  assert.match(monitor,/kind:'配送長期化'/);
  assert.match(html,/ev\.alerts\.some\(a=>a\.level==='critical'\)/);
  const gateStart=html.indexOf('function launchEligibility(');
  const gateEnd=html.indexOf('function scaleEligibility(',gateStart);
  const gate=html.slice(gateStart,gateEnd);
  assert.match(gate,/x\.monitorRisk!=='ok'/);
  assert.match(gate,/最新CJ監視未確認/);
});

test('CJ risk gate excludes mid and high complaint risk products',()=>{
  const risk=fs.readFileSync(new URL('../lib/routes/cj-risk.js',import.meta.url),'utf8');
  assert.match(risk,/label:'返品・クレーム高リスク',exclude:true/);
  assert.match(risk,/label:'返品・クレーム要注意',exclude:true/);
  assert.match(risk,/rating<4\.0/);
  assert.match(risk,/lowRate>=0\.05/);
});


test('automatic recommendations require at least 21 units of verified discovery inventory',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const search=fs.readFileSync(new URL('../lib/routes/cj-search.js',import.meta.url),'utf8');
  assert.match(html,/SAFE_DISCOVERY_MIN_VERIFIED_INVENTORY=21/);
  assert.match(html,/minVerifiedInventory=\$\{SAFE_DISCOVERY_MIN_VERIFIED_INVENTORY\}/);
  assert.match(search,/minVerifiedInventory/);
  assert.match(search,/p\.verifiedInventory>=minVerifiedInventory/);
  assert.match(search,/Variant-level CJ stock is reverified before launch/);
});


test('launch gate and automatic pricing preserve at least 35 percent contribution margin after payment fee',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/SAFE_MIN_CONTRIBUTION_MARGIN_PERCENT=35/);
  assert.match(html,/targetMargin=SAFE_MIN_CONTRIBUTION_MARGIN_PERCENT\/100/);
  assert.match(html,/1-paymentFeeRate-targetMargin/);
  assert.match(html,/限界利益率35%未満/);
});


test('launch gate fails closed until ad cost and return reserve assumptions are explicitly set',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('function launchEligibility(');
  const end=html.indexOf('function scaleEligibility(',start);
  const gate=html.slice(start,end);
  assert.match(gate,/plannedAdCostPerOrderJpy/);
  assert.match(gate,/returnReservePerOrderJpy/);
  assert.match(gate,/広告費想定未設定/);
  assert.match(gate,/返品・返金引当未設定/);
  assert.match(gate,/広告費・返品引当後の利益が赤字/);
});


test('automatic profit assumptions derive ad cost from CPA safety policy and return reserve from the 15 percent stop threshold',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/SAFE_RETURN_RESERVE_RATE=0\.15/);
  assert.match(html,/function autoProfitAssumptions\(x\)/);
  assert.match(html,/plannedAdCostPerOrderJpy=ad/);
  assert.match(html,/returnReservePerOrderJpy=reserve/);
  assert.match(html,/autoProfitAssumptions\(x\);/);
  assert.match(html,/out\.adCostPerOrderJpy=adCost/);
  assert.match(html,/out\.returnReservePerOrderJpy=reserve/);
});


test('negative planned final profit auto-removes the candidate before Shopify draft creation and refreshes recommendations',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/function plannedFinalProfit\(x\)/);
  assert.match(html,/function excludeUnprofitableCandidateAndRefill\(x\)/);
  assert.match(html,/x\.uiSelected=false/);
  assert.match(html,/final_profit_not_positive/);
  assert.match(html,/setRecentlyRemovedCandidate\(x,true\)/);
  assert.match(html,/runAutoScan\(true\)/);
  assert.match(html,/if\(excludeUnprofitableCandidateAndRefill\(x\)\)return/);
});


test('auto-excluded unprofitable products cannot re-enter recommendations through recently removed history',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/autoExcludedReason='final_profit_not_positive'/);
  assert.match(html,/filter\(p=>!p\.autoExcludedReason\)/);
  assert.match(html,/利益ゲートで除外された商品のため再選択できません/);
});
