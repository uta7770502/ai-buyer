import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-readiness.js';
const keys=['AI_BUYER_ADMIN_KEY','SHOPIFY_ALLOWED_SHOP_DOMAIN','SHOPIFY_CLIENT_SECRET','SHOPIFY_ADMIN_ACCESS_TOKEN','CJ_ACCESS_TOKEN','CJ_API_KEY','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','CJ_MAX_ITEMS_PER_ORDER','CJ_MAX_ORDER_VALUE','CJ_ORDER_LIMIT_CURRENCY','CJ_MAX_FREIGHT_USD','CJ_ALLOWED_DESTINATION_COUNTRY','CJ_SANDBOX_ORDER_ENABLED','CJ_SANDBOX_TRACKING_SYNC_ENABLED'];
async function invoke({method='GET',auth='Bearer test-admin',configured=false,overrides={}}={}){
  const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const fetchBefore=globalThis.fetch;
  for(const k of keys)delete process.env[k];
  process.env.AI_BUYER_ADMIN_KEY='test-admin';
  if(configured)Object.assign(process.env,{
    SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',SHOPIFY_CLIENT_SECRET:'SECRET_VALUE',
    SHOPIFY_ADMIN_ACCESS_TOKEN:'SHOPIFY_SECRET_VALUE',CJ_ACCESS_TOKEN:'CJ_SECRET_VALUE',
    UPSTASH_REDIS_REST_URL:'https://redis.example',UPSTASH_REDIS_REST_TOKEN:'REDIS_SECRET_VALUE',
    CJ_MAX_ITEMS_PER_ORDER:'10',CJ_MAX_ORDER_VALUE:'10000',CJ_ORDER_LIMIT_CURRENCY:'JPY',
    CJ_MAX_FREIGHT_USD:'50',CJ_ALLOWED_DESTINATION_COUNTRY:'JP'
  });
  Object.assign(process.env,overrides);
  globalThis.fetch=async()=>{throw Error('Readiness must not access external APIs');};
  let statusCode,body;
  const headers={};
  const res={setHeader(k,v){headers[k]=v;},status(n){statusCode=n;return this;},json(v){body=v;return v;}};
  try{await handler({method,headers:{authorization:auth}},res);return {statusCode,body,headers};}
  finally{globalThis.fetch=fetchBefore;for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('readiness requires admin authorization',async()=>{
  const x=await invoke({auth:'Bearer wrong',configured:true});
  assert.equal(x.statusCode,401);
});
test('readiness never enables any automation',async()=>{
  const x=await invoke({configured:true});
  assert.equal(x.statusCode,200);
  assert.equal(x.body.readyForSandboxConfiguration,true);
  assert.equal(x.body.flags.sandboxOrderEnabled,false);
  assert.equal(x.body.flags.sandboxTrackingSyncEnabled,false);
  assert.equal(x.body.liveIntegrationVerified,false);
});
test('readiness reports missing config without exposing secrets',async()=>{
  const x=await invoke();
  assert.equal(x.statusCode,200);
  assert.equal(x.body.readyForSandboxConfiguration,false);
  assert.ok(x.body.missing.includes('cjAuthentication'));
  assert.ok(!JSON.stringify(x.body).includes('test-admin'));
});
test('readiness does not leak configured credentials',async()=>{
  const x=await invoke({configured:true});
  const output=JSON.stringify(x.body);
  for(const secret of ['SECRET_VALUE','SHOPIFY_SECRET_VALUE','CJ_SECRET_VALUE','REDIS_SECRET_VALUE'])assert.ok(!output.includes(secret));
});

test('readiness rejects fractional item limits and invalid freight caps',async()=>{
  const fractional=await invoke({configured:true,overrides:{CJ_MAX_ITEMS_PER_ORDER:'1.5'}});
  assert.equal(fractional.body.configured.orderLimits,false);
  assert.equal(fractional.body.readyForSandboxConfiguration,false);
  const freight=await invoke({configured:true,overrides:{CJ_MAX_FREIGHT_USD:'Infinity'}});
  assert.equal(freight.body.configured.freightLimit,false);
});

test('readiness rejects missing and malformed bearer tokens',async()=>{
  for(const auth of ['', 'test-admin', 'Bearer test-admin-extra','bearer test-admin']){
    const x=await invoke({auth,configured:true});
    assert.equal(x.statusCode,401);
  }
});
test('readiness rejects non-GET methods without disclosing configuration',async()=>{
  const x=await invoke({method:'POST',configured:true});
  assert.equal(x.statusCode,405);
  assert.equal(x.body.ok,false);
});

test('readiness responses disable caching and content sniffing',async()=>{
  const x=await invoke({configured:true});
  assert.equal(x.headers['Cache-Control'],'no-store');
  assert.equal(x.headers.Pragma,'no-cache');
  assert.equal(x.headers['X-Content-Type-Options'],'nosniff');
});

test('readiness distinguishes configured credentials from verified live integrations',async()=>{
  const x=await invoke({configured:true});
  assert.equal(x.body.readyForSandboxConfiguration,true);
  assert.equal(x.body.liveIntegrationVerified,false);
  assert.deepEqual(x.body.nextChecks.map(v=>v.id),[
    'shopify-webhook','shopify-catalog','cj-sandbox-order','redis-deduplication','shopify-fulfillment'
  ]);
  assert.ok(x.body.nextChecks.every(v=>v.verified===false));
});

test('readiness gives actionable setup guidance only for missing checks',async()=>{
  const missing=await invoke();
  assert.equal(missing.body.remediation.length,missing.body.missing.length);
  assert.ok(missing.body.remediation.every(v=>missing.body.missing.includes(v.id)&&typeof v.instruction==='string'));
  const configured=await invoke({configured:true});
  assert.deepEqual(configured.body.remediation,[]);
});

test('readiness status distinguishes missing setup from pending external verification',async()=>{
  const missing=await invoke();
  assert.equal(missing.body.readinessStatus,'configuration_incomplete');
  const configured=await invoke({configured:true});
  assert.equal(configured.body.readinessStatus,'awaiting_live_verification');
  assert.equal(configured.body.liveIntegrationVerified,false);
});

test('readiness summary counts configuration and unverified integration checks',async()=>{
  const missing=await invoke();
  assert.equal(missing.body.summary.configuredChecks,1); // JP destination default is valid
  assert.equal(missing.body.summary.totalConfigurationChecks,8);
  assert.equal(missing.body.summary.remainingExternalChecks,5);
  const configured=await invoke({configured:true});
  assert.equal(configured.body.summary.configuredChecks,8);
  assert.equal(configured.body.summary.remainingExternalChecks,5);
});

test('readiness rejects invalid Shopify domains and destination codes',async()=>{
  const domain=await invoke({configured:true,overrides:{SHOPIFY_ALLOWED_SHOP_DOMAIN:'evil.example.com'}});
  assert.equal(domain.body.configured.shopifyMerchant,false);
  const country=await invoke({configured:true,overrides:{CJ_ALLOWED_DESTINATION_COUNTRY:'JPN'}});
  assert.equal(country.body.configured.destinationCountry,false);
});
test('readiness accepts CJ API key when direct access token is absent',async()=>{
  const x=await invoke({configured:true,overrides:{CJ_ACCESS_TOKEN:'',CJ_API_KEY:'CJ_API_KEY_VALUE'}});
  assert.equal(x.body.configured.cjAuthentication,true);
  assert.ok(!JSON.stringify(x.body).includes('CJ_API_KEY_VALUE'));
});
