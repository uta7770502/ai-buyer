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
  assert.match(block,/inventory<5/);
  assert.match(block,/CJ Trending未確認/);
  assert.match(block,/検証済み在庫が5件未満/);
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


test('discovery allows factory-stock candidates but verified inventory is still required for approved recommendations',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const search=fs.readFileSync(new URL('../lib/routes/cj-search.js',import.meta.url),'utf8');
  assert.match(html,/SAFE_DISCOVERY_MIN_VERIFIED_INVENTORY=5/);
  assert.match(html,/minVerifiedInventory=0/);
  assert.match(html,/function recommendationStockReady\(p/);
  assert.match(html,/Number\(p\.verifiedInventory\)>=5/);
  assert.match(search,/minVerifiedInventory/);
  assert.match(search,/p\.verifiedInventory>=minVerifiedInventory/);
  assert.match(search,/Variant-level CJ stock is reverified before launch/);
});


test('automatic pricing uses target 30 percent net margin while launch retains its contribution gate',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/SAFE_MIN_CONTRIBUTION_MARGIN_PERCENT=25/);
  assert.match(html,/targetMarginPercent=30/);
  assert.match(html,/calculateTargetSalePrice\(/);
  assert.match(html,/priceEstimateOnly=true/);
  assert.match(html,/限界利益率が商品別の基準未満/);
  assert.match(html,/if\(!verifiedMarginRecommendation\(x\)\)/);
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
  assert.match(html,/provisional:ad20pct-landed\+return15pct/);
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


test('replacement recommendations exclude auto-blocked products and require verified inventory before refill',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/function recommendationStockReady\(p/);
  assert.match(html,/Number\(p\.verifiedInventory\)>=5/);
  assert.match(html,/const refillSafe=safe\.filter\(x=>\{const a=findActive\(x\.id\);return \(!a\|\|!a\.autoExcludedReason\)&&verifiedMarginRecommendation\(x\)\}\)/);
  assert.match(html,/在庫・レビュー・利益安全ゲート通過/);
});


test('selected candidates with verified variant inventory below 21 are auto-removed before Shopify draft creation',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/function excludeLowStockCandidateAndRefill\(x\)/);
  assert.match(html,/variantInventoryVerified!==true/);
  assert.match(html,/inventory>=SAFE_DISCOVERY_MIN_VERIFIED_INVENTORY/);
  assert.match(html,/verified_inventory_below_launch_floor/);
  assert.match(html,/在庫ゲート除外/);
  assert.match(html,/api\/cj-variant-stock\?vid=/);
  assert.match(html,/variantInventoryVerified=true/);
  assert.match(html,/if\(excludeLowStockCandidateAndRefill\(x\)\)return/);
  assert.match(html,/在庫ゲートで除外された商品のため再選択できません/);
  assert.match(html,/runAutoScan\(true\)/);
});


test('variant-level CJ stock verification is read-only validated and launch-gated at 21 units',()=>{
  const route=fs.readFileSync(new URL('../lib/routes/cj-variant-stock.js',import.meta.url),'utf8');
  const api=fs.readFileSync(new URL('../api/cj.js',import.meta.url),'utf8');
  const vercel=fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8');
  assert.match(route,/validateCJStockResponse/);
  assert.match(route,/req\.method!=='GET'/);
  assert.match(route,/readOnly:true/);
  assert.match(route,/launchEligible:checked\.total>=MIN_LAUNCH_INVENTORY/);
  assert.match(route,/minimumLaunchInventory:MIN_LAUNCH_INVENTORY/);
  assert.match(api,/'variant-stock':cjVariantStock/);
  assert.match(vercel,/\/api\/cj-variant-stock/);
});


test('variant stock verification failures fail closed and are eligible for automatic retry',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/variant_stock_unverified:/);
  assert.match(html,/x\.variantInventoryVerified=false/);
  assert.match(html,/x\.variantInventoryVerifiedAt=''/);
  assert.match(html,/m\.startsWith\('variant_stock_unverified:'\)\)return true/);
});


test('launch eligibility requires fresh variant-level stock verification within 15 minutes',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('function launchEligibility(');
  const end=html.indexOf('function scaleEligibility(',start);
  const gate=html.slice(start,end);
  assert.match(gate,/variantInventoryVerifiedAt/);
  assert.match(gate,/variantInventoryVerified===true/);
  assert.match(gate,/15\*60\*1000/);
  assert.match(gate,/variant在庫の最新確認が必要/);
  assert.match(gate,/freshVariantInventory/);
});


test('variant stock route rejects implausibly large supplier totals',()=>{
  const route=fs.readFileSync(new URL('../lib/routes/cj-variant-stock.js',import.meta.url),'utf8');
  assert.match(route,/checked\.total>1000000/);
  assert.match(route,/outside safe bounds/);
});


test('variant stock launch floor is defined once and returned with every verified response',()=>{
  const route=fs.readFileSync(new URL('../lib/routes/cj-variant-stock.js',import.meta.url),'utf8');
  assert.match(route,/const MIN_LAUNCH_INVENTORY=5/);
  assert.match(route,/launchEligible:checked\.total>=MIN_LAUNCH_INVENTORY/);
  assert.match(route,/minimumLaunchInventory:MIN_LAUNCH_INVENTORY/);
});

test('ADPS reference navigation keeps five distinct destinations and preserves launch safety',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 for(const id of ['home','recommend','operations','profit','settings'])assert.match(html,new RegExp('<section id="'+id+'" class="page(?: on)?"'));
 assert.match(html,/showPage\('operations',this\)/);
 assert.match(html,/showPage\('settings',this\)/);
 assert.match(html,/function syncAdpsHomeSummary\(/);
 assert.match(html,/priceEstimateOnly===true/);
});


test('ADPS prelaunch UI does not misrepresent production automation as active',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/AI運用の準備・検証中/);
 assert.doesNotMatch(html,/<b>AI自動運用中<\/b>/);
 assert.match(html,/本番公開・広告配信・実発注は承認まで停止/);
});

test('ADPS operations details expand in place and mobile layouts wrap',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=html.indexOf('function syncAdpsOperations()');
 const end=html.indexOf('</script>',start);
 const operations=html.slice(start,end);
 assert.match(operations,/<details class="adpsOpDetails">/);
 assert.match(operations,/<summary>運用詳細<\/summary>/);
 assert.match(operations,/shopifyPublishState/);
 assert.match(operations,/autoSetupState/);
 assert.doesNotMatch(operations,/showPage\(\\'profit\\'\)/);
 assert.match(html,/@media\(max-width:380px\)\{\.adpsOpRowFoot\{align-items:flex-start;flex-wrap:wrap/);
});

test('ADPS product detail keeps modal accessible and fails closed on mismatched products',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/id="modal" role="dialog" aria-modal="true"/);
 assert.match(html,/requestVersion!==detailRequestVersion/);
 assert.match(html,/String\(j\.product\.id\)!==String\(id\)/);
 assert.match(html,/if\(typeof document\.addEventListener==='function'\)/);
 assert.match(html,/typeof HTMLElement!=='undefined'/);
});


test('ADPS mobile viewport allows zoom and preserves iPhone safe areas',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
 assert.doesNotMatch(html,/maximum-scale=1|user-scalable=no/);
 assert.match(html,/safe-area-inset-bottom/);
 assert.match(html,/\.nav button,\.nav button\.navFind\{box-sizing:border-box;flex:1 1 0/);
});


test('ADPS Shopify live publication stays disabled until explicit launch authorization',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/disabled aria-disabled="true" title="本番公開は承認まで停止中"/);
 assert.match(html,/公開待ち（承認後）/);
 assert.match(html,/showCandidateToast\('本番公開は承認まで停止しています'\);/);
 const start=html.indexOf("document.addEventListener('click',e=>{\n  const btn=e.target.closest('[data-live-publish-id]')");
 assert.ok(start>=0,'live publish guard handler must exist');
 const handler=html.slice(start,html.indexOf('\n});',start)+4);
 assert.doesNotMatch(handler,/fetch\(|resumeApproved|syncAction/);
});
