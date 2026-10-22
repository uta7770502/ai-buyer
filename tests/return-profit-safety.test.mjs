import test from 'node:test';
import assert from 'node:assert/strict';
import profit from '../lib/routes/profit-estimate.js';
import triage from '../lib/routes/return-triage.js';
function response(){return {statusCode:200,setHeader(){return this},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}}}
async function run(handler,method,body,authorization){
 const res=response();
 await handler({method,body,headers:authorization?{authorization}:{},query:{}},res);
 return res;
}
test('financial and return diagnostics reject unauthenticated requests',async()=>{
 const old=process.env.AI_BUYER_ADMIN_KEY;process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 try{
  assert.equal((await run(profit,'POST',{salePrice:1000})).statusCode,401);
  assert.equal((await run(triage,'POST',{type:'damaged'})).statusCode,401);
 }finally{if(old===undefined)delete process.env.AI_BUYER_ADMIN_KEY;else process.env.AI_BUYER_ADMIN_KEY=old}
});
test('profit estimate subtracts costs and refund risk without side effects',async()=>{
 const old=process.env.AI_BUYER_ADMIN_KEY;process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 try{
  const res=await run(profit,'POST',{salePrice:1000,purchaseCost:400,shippingCost:100,paymentFee:30,expectedRefundLoss:20},'Bearer test-only-secret');
  assert.equal(res.statusCode,200);assert.equal(res.body.estimatedProfit,450);assert.equal(res.body.marginPercent,45);assert.equal(res.body.readOnly,true);
 }finally{if(old===undefined)delete process.env.AI_BUYER_ADMIN_KEY;else process.env.AI_BUYER_ADMIN_KEY=old}
});
test('return triage flags out-of-window cases and never triggers refunds',async()=>{
 const old=process.env.AI_BUYER_ADMIN_KEY;process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 try{
  const res=await run(triage,'POST',{type:'damaged',daysSinceDelivery:15,returnWindowDays:7},'Bearer test-only-secret');
  assert.equal(res.statusCode,200);assert.equal(res.body.policyReviewRequired,true);assert.equal(res.body.refundIssued,false);assert.equal(res.body.customerMessageSent,false);
 }finally{if(old===undefined)delete process.env.AI_BUYER_ADMIN_KEY;else process.env.AI_BUYER_ADMIN_KEY=old}
});

test('return triage requires policy review when delivery date or return window is unknown',async()=>{
 const old=process.env.AI_BUYER_ADMIN_KEY;process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 try{
  const missing=await run(triage,'POST',{type:'defective'},'Bearer test-only-secret');
  assert.equal(missing.statusCode,200);
  assert.equal(missing.body.policyReviewRequired,true);
  assert.equal(missing.body.returnEligibilityVerified,false);
  assert.equal(missing.body.refundIssued,false);
  const known=await run(triage,'POST',{type:'defective',daysSinceDelivery:3,returnWindowDays:7},'Bearer test-only-secret');
  assert.equal(known.body.policyReviewRequired,false);
  assert.equal(known.body.withinProvidedReturnWindow,true);
  assert.equal(known.body.returnEligibilityVerified,false);
  assert.equal(known.body.manualApprovalRequired,true);
 }finally{if(old===undefined)delete process.env.AI_BUYER_ADMIN_KEY;else process.env.AI_BUYER_ADMIN_KEY=old}
});

test('CJ readiness never claims live order automation is enabled',async()=>{
 const readiness=(await import('../lib/routes/cj-readiness.js')).default;
 const old=process.env.AI_BUYER_ADMIN_KEY;process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 try{
  const r=await run(readiness,'GET',{},'Bearer test-only-secret');
  assert.equal(r.statusCode,200);
  assert.equal(r.body.fulfillmentMode,'sandbox_test_orders_only');
  assert.equal(r.body.liveOrderAutomationEnabled,false);
  assert.equal(r.body.liveIntegrationVerified,false);
 }finally{if(old===undefined)delete process.env.AI_BUYER_ADMIN_KEY;else process.env.AI_BUYER_ADMIN_KEY=old}
});

test('reconciliation summary marks missing CJ order identifiers as critical',async()=>{
 const reconcile=(await import('../lib/routes/automation-reconciliation.js')).default;
 const oldKey=process.env.AI_BUYER_ADMIN_KEY,oldUrl=process.env.UPSTASH_REDIS_REST_URL,oldToken=process.env.UPSTASH_REDIS_REST_TOKEN,oldFetch=globalThis.fetch;
 process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 process.env.UPSTASH_REDIS_REST_URL='https://redis.test';
 process.env.UPSTASH_REDIS_REST_TOKEN='redis-test-token';
 globalThis.fetch=async(_url,opts)=>{
  const cmd=JSON.parse(opts.body);
  const result=cmd[0]==='SCAN'?['0',cmd[3].startsWith('ai-buyer:cj-sandbox:')?['ai-buyer:cj-sandbox:test']:[]]:cmd[0]==='MGET'?['needs_review:missing_cj_order_id']:null;
  return {ok:true,json:async()=>({result})};
 };
 try{
  const res={statusCode:200,setHeader(){return this},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}};
  await reconcile({method:'GET',query:{kind:'summary'},headers:{authorization:'Bearer test-only-secret'}},res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.summary.critical,1);
  assert.equal(res.body.summary.byKind.cj.critical,1);
 }finally{
  globalThis.fetch=oldFetch;
  for(const [k,v] of [['AI_BUYER_ADMIN_KEY',oldKey],['UPSTASH_REDIS_REST_URL',oldUrl],['UPSTASH_REDIS_REST_TOKEN',oldToken]]){if(v===undefined)delete process.env[k];else process.env[k]=v}
 }
});

test('management reconciliation UI treats missing CJ order ID as critical',async()=>{
 const fs=await import('node:fs/promises');
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/\['cj_rejected','shopify_rejected','missing_cj_order_id'\]\.includes\(x\.reason\)/);
});

test('partial reconciliation never renders a clean bill of health after reload',async()=>{
 const fs=await import('node:fs/promises');
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/reconciliationLoadedCount===0&&!partial/);
 assert.match(html,/一部のみ確認・再確認が必要/);
});

test('partial reconciliation cannot pass go-live readiness freshness gate',async()=>{
 const fs=await import('node:fs/promises');
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 const start=html.indexOf('function reconciliationSummaryIsFresh(){');
 const end=html.indexOf('async function loadReconciliationSummary()',start);
 const fn=html.slice(start,end);
 assert.match(fn,/\.partial===true\)return false/);
 assert.match(html,/reconciliationSummaryChecked&&reconciliationCriticalCount===0&&reconciliationReviewCount===0&&reconciliationSummaryIsFresh\(\)/);
});

test('reconciliation summary rejects malformed Redis scan cursor',async()=>{
 const reconcile=(await import('../lib/routes/automation-reconciliation.js')).default;
 const envKeys=['AI_BUYER_ADMIN_KEY','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
 const prior=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 const oldFetch=globalThis.fetch;
 process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 process.env.UPSTASH_REDIS_REST_URL='https://redis.test';
 process.env.UPSTASH_REDIS_REST_TOKEN='redis-test-token';
 globalThis.fetch=async()=>({ok:true,json:async()=>({result:['invalid-cursor',[]]})});
 try{
  const res={statusCode:200,setHeader(){return this},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}};
  await reconcile({method:'GET',query:{kind:'summary'},headers:{authorization:'Bearer test-only-secret'}},res);
  assert.equal(res.statusCode,503);
  assert.equal(res.body.ok,false);
 }finally{
  globalThis.fetch=oldFetch;
  for(const [k,v] of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v}
 }
});

test('reconciliation summary rejects keys outside the expected namespace',async()=>{
 const reconcile=(await import('../lib/routes/automation-reconciliation.js')).default;
 const envKeys=['AI_BUYER_ADMIN_KEY','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
 const prior=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 const oldFetch=globalThis.fetch;
 process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 process.env.UPSTASH_REDIS_REST_URL='https://redis.test';
 process.env.UPSTASH_REDIS_REST_TOKEN='redis-test-token';
 globalThis.fetch=async()=>({ok:true,json:async()=>({result:['0',['unrelated:order-key']]})});
 try{
  const res={statusCode:200,setHeader(){return this},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}};
  await reconcile({method:'GET',query:{kind:'summary'},headers:{authorization:'Bearer test-only-secret'}},res);
  assert.equal(res.statusCode,503);
  assert.equal(res.body.ok,false);
 }finally{
  globalThis.fetch=oldFetch;
  for(const [k,v] of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v}
 }
});

test('CJ sandbox preflight uses bounded authentication and freight requests',async()=>{
 const fs=await import('node:fs/promises');
 const source=await fs.readFile(new URL('../api/shopify-order-webhook.js',import.meta.url),'utf8');
 assert.match(source,/authentication\/getAccessToken[\s\S]*?signal:AbortSignal\.timeout\(10000\)/);
 assert.match(source,/logistic\/freightCalculate[\s\S]*?signal:AbortSignal\.timeout\(10000\)/);
 assert.ok(source.indexOf('logistic/freightCalculate')<source.indexOf('const reserved=await reserveOrder'));
});

test('invalid CJ order identifiers are quarantined and shown as critical',async()=>{
 const fs=await import('node:fs/promises');
 const webhook=await fs.readFile(new URL('../api/shopify-order-webhook.js',import.meta.url),'utf8');
 const reconciliation=await fs.readFile(new URL('../lib/routes/automation-reconciliation.js',import.meta.url),'utf8');
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(webhook,/needs_review:invalid_cj_order_id/);
 assert.match(reconciliation,/invalid_cj_order_id:100/);
 assert.match(html,/invalid_cj_order_id:'CJ注文IDの形式が不正'/);
});

test('CJ tracking sync validates tracking numbers before Shopify mutation',async()=>{
 const fs=await import('node:fs/promises');
 const source=await fs.readFile(new URL('../lib/routes/cj-tracking-sync.js',import.meta.url),'utf8');
 assert.match(source,/\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,99\}\$/);
 assert.ok(source.indexOf("test(tracking)")<source.indexOf("const mutation="));
 const valid=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
 for(const value of ['CJ123456789','YT-2026_ABC.9'])assert.equal(valid.test(value),true);
 for(const value of ['A B','A\nB','<bad>','', 'a'.repeat(101)])assert.equal(valid.test(value),false);
});

test('return triage never declares an item eligible based solely on timing',async()=>{
 const old=process.env.AI_BUYER_ADMIN_KEY;process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 try{
  for(const type of ['damaged','defective','missing','wrong_item','late','change_of_mind','other']){
   const res=await run(triage,'POST',{type,daysSinceDelivery:0,returnWindowDays:30},'Bearer test-only-secret');
   assert.equal(res.statusCode,200);
   assert.equal(res.body.withinProvidedReturnWindow,true);
   assert.equal(res.body.returnEligibilityVerified,false);
   assert.equal(res.body.manualApprovalRequired,true);
   assert.equal(res.body.refundIssued,false);
  }
 }finally{if(old===undefined)delete process.env.AI_BUYER_ADMIN_KEY;else process.env.AI_BUYER_ADMIN_KEY=old}
});

test('CJ product risk cannot be low when reviews are unavailable or insufficient',async()=>{
 const fs=await import('node:fs/promises');
 const source=await fs.readFile(new URL('../lib/routes/cj-risk.js',import.meta.url),'utf8');
 assert.match(source,/reviewDataComplete=all!==null/);
 assert.match(source,/reason:'review-data-unavailable'/);
 assert.match(source,/if\(total<5\)return \{level:'unknown'/);
 assert.match(source,/reason:'insufficient-review-evidence'/);
 assert.match(source,/exclude:true,reason:'review-data-unavailable'/);
});

test('CJ risk screening fails closed on inconsistent review counts',async()=>{
 const fs=await import('node:fs/promises');
 const source=await fs.readFile(new URL('../lib/routes/cj-risk.js',import.meta.url),'utf8');
 assert.match(source,/score1\+score2<=Number\(all\.total\)/);
 assert.match(source,/Number\.isSafeInteger\(Number\(all\.total\)\)/);
 assert.match(source,/reviewDataComplete\?scoreRisk/);
 assert.match(source,/review-data-unavailable/);
});

test('ODDLY pet-first recommendations use product metadata rather than keyword alone',async()=>{
 const fs=await import('node:fs/promises');
 const source=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(source,/function oddlyPetRelevant\(p\)/);
 assert.match(source,/\[p\.name,p\.title,p\.productName,p\.categoryName\]/);
 assert.match(source,/dedupe\(pool\)\.filter\(oddlyPetRelevant\)/);
 assert.match(source,/dog accessories/);
 assert.match(source,/cat accessories/);
});

test('ODDLY cached recommendations cannot resurface non-pet products',async()=>{
 const fs=await import('node:fs/promises');
 const source=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(source,/today\.products\.filter\(oddlyPetRelevant\)\.slice\(0,5\)/);
 assert.match(source,/today\.products\.filter\(oddlyPetRelevant\)\.map/);
 assert.match(source,/picks\.filter\(oddlyPetRelevant\)\.length<3/);
});

test('ODDLY research-based category boost is separate from CJ product safety filters',async()=>{
 const fs=await import('node:fs/promises');
 const source=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(source,/function oddlyDemandPoints\(p\)/);
 assert.match(source,/puzzle\|enrichment\|interactive/);
 assert.match(source,/groom\|deshed\|pet\.hair/);
 assert.match(source,/safe=passed\.filter\(x=>!catalogRisk\(x\)\.exclude\)\.sort/);
 assert.match(source,/CJ掲載実績あり/);
 assert.doesNotMatch(source,/売れ筋確認済<\/span>/);
});
