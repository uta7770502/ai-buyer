import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { redisConnection } from '../lib/redis-connection.js';

const source=readFileSync(new URL('../lib/routes/release-readiness.js',import.meta.url),'utf8')
  .replace("import { redisConnection } from '../redis-connection.js';",'')
  .replace("import { loadShopifySession } from '../shopify-session-store.js';",'').replace("import { loadLegalConfig } from '../legal-config-store.js';",'').replace('export default async function handler','async function handler')+'\nthis.handler=handler;';

function run(env={},loadLegalConfig=async()=>null,fetchOverride){
  const context={loadShopifySession:async()=>null,loadLegalConfig,process:{env:{AI_BUYER_ADMIN_KEY:'test-admin-key',...env}},fetch:async()=>{throw Error('Network calls must not be made in this fixture')},AbortSignal,Date,Boolean,String,Number,RegExp};
  if(fetchOverride)context.fetch=fetchOverride;
  context.redisConnection=()=>redisConnection(context.process.env);
  vm.runInNewContext(source,context);
  let status=0,body;
  const res={setHeader(){},status(code){status=code;return this},json(value){body=JSON.parse(JSON.stringify(value));return this}};
  return context.handler({method:'GET',headers:{authorization:'Bearer test-admin-key'}},res).then(()=>({status,body}));
}
test('readiness rejects missing server-side Shopify token even if OAuth credentials exist',async()=>{
  const {status,body}=await run({SHOPIFY_CLIENT_ID:'client',SHOPIFY_CLIENT_SECRET:'secret',SHOPIFY_SHOP:'test-store',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test-store.myshopify.com'});
  assert.equal(status,200);
  assert.equal(body.checks.shopifyServerTokenConfigured,false);
  assert.equal(body.shopifyServerAuthReady,false);
  assert.ok(body.blockers.some(x=>x.startsWith('Shopify server session missing')));
  assert.equal(body.safeToTest,false);
  assert.equal(body.readyForLive,false);
  assert.equal(body.liveCjOrdersEnabled,false);
});
test('server token presence is not proof of API connectivity',async()=>{
  const {body}=await run({SHOPIFY_ADMIN_ACCESS_TOKEN:'test-token',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test-store.myshopify.com'});
  assert.equal(body.checks.shopifyServerTokenConfigured,true);
  assert.equal(body.shopifyServerAuthReady,false);
  assert.equal(body.externalChecks.shopifyAdminVerified,false);
  assert.equal(body.safeToTest,false);
});
test('readiness requires administrator authorization',async()=>{
  const context={loadShopifySession:async()=>null,process:{env:{AI_BUYER_ADMIN_KEY:'test-admin-key'}},fetch:async()=>{throw Error('Unexpected network')},AbortSignal,Date,Boolean,String,Number};
  context.redisConnection=()=>redisConnection(context.process.env);
  vm.runInNewContext(source,context);
  let status;const res={setHeader(){},status(code){status=code;return this},json(){return this}};
  await context.handler({method:'GET',headers:{}},res);
  assert.equal(status,401);
});

const completeLegalEnv={ODDLY_SELLER_NAME:'Seller',ODDLY_REPRESENTATIVE_NAME:'Owner',ODDLY_SELLER_ADDRESS:'Tokyo',ODDLY_SUPPORT_PHONE:'03-0000-0000',ODDLY_SUPPORT_EMAIL:'support@example.com',ODDLY_PAYMENT_TIMING:'注文時',ODDLY_SHIPPING_WINDOW:'7日以内',ODDLY_RETURN_DAYS:'7',ODDLY_RETURN_CONDITIONS:'未使用品',ODDLY_RETURN_SHIPPING:'販売者負担',ODDLY_ADDITIONAL_FEES:'なし',ODDLY_PRIVACY_CONTACT:'privacy@example.com'};
test('readiness never substitutes environment policies for an unreadable saved policy',async()=>{
 const {body}=await run(completeLegalEnv,async()=>{throw Error('decrypt failed: sensitive detail')});
 assert.equal(body.legalReadFailed,true);assert.equal(body.legalReady,false);assert.equal(body.legalSource,'unavailable');
 assert.equal(body.prelaunchReady,false);assert.equal(body.safeToTest,false);
 assert.ok(body.blockers.some(x=>x.includes('未入力とは限りません')));
 assert.ok(!body.blockers.includes('ODDLY legal/policy information incomplete'));
 assert.ok(!JSON.stringify(body).includes('sensitive detail'));
});
test('readiness uses environment policies only after confirmed absence of saved data',async()=>{
 const {body}=await run(completeLegalEnv);
 assert.equal(body.legalReadFailed,false);assert.equal(body.legalReady,true);assert.equal(body.legalSource,'environment');
});

const launchEnv={...completeLegalEnv,
 SHOPIFY_CLIENT_ID:'client',SHOPIFY_CLIENT_SECRET:'secret',SHOPIFY_ADMIN_ACCESS_TOKEN:'admin-token',
 SHOPIFY_SHOP:'test-store',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test-store.myshopify.com',
 SHOPIFY_STOREFRONT_ACCESS_TOKEN:'storefront-token',SHOPIFY_WEBHOOK_BASE_URL:'https://preview.example',
 CJ_ACCESS_TOKEN:'cj-token',UPSTASH_REDIS_REST_URL:'https://redis.example',UPSTASH_REDIS_REST_TOKEN:'redis-token',
 CJ_SANDBOX_ORDER_ENABLED:'true',SHOPIFY_FULFILLMENT_SYNC_ENABLED:'true',
 CJ_MAX_ITEMS_PER_ORDER:'5',CJ_MAX_ORDER_VALUE:'10000',CJ_MAX_FREIGHT_USD:'50',CJ_ORDER_LIMIT_CURRENCY:'JPY'};
function services(failed){return async(url,options={})=>{
 const query=JSON.parse(options.body||'{}').query||'';
 assert.ok(!/mutation/i.test(query),'Release diagnostics must never mutate Shopify');
 let kind,data;
 if(url.endsWith('/ping')){kind='redis';data={result:'PONG'}}
 else if(url.includes('/getCategory')){kind='cj';data={result:true,data:[]}}
 else if(query.includes('ReadinessShop')){kind='admin';data={data:{shop:{id:'gid://shopify/Shop/1',name:'ODDLY'}}}}
 else if(query.includes('ReadinessScopes')){kind='scope';data={data:{currentAppInstallation:{accessScopes:[{handle:'write_merchant_managed_fulfillment_orders'},{handle:'read_inventory'},{handle:'write_inventory'}]}}}}
 else if(query.includes('ReadinessWebhooks')){kind='webhook';data={data:{webhookSubscriptions:{nodes:[{topic:'ORDERS_PAID',uri:'https://preview.example/api/shopify-order-webhook'}],pageInfo:{hasNextPage:false}}}}}
 else if(query.includes('ReadinessStorefront')){kind='storefront';data={data:{shop:{name:'ODDLY'}}}}
 else throw Error('Unexpected external request');
 return {ok:kind!==failed,json:async()=>kind===failed?{errors:[{message:'private-service-error'}]}:data};
};}
test('storefront outage is a warning, not a blocker for backend sandbox checks',async()=>{
 const {body}=await run(launchEnv,async()=>null,services('storefront'));
 assert.equal(body.prelaunchReady,true);
 assert.equal(body.safeToTest,true);
 assert.equal(body.readyForLive,false);
 assert.ok(body.warnings.includes('Shopify Storefront API connection unverified; backend sandbox validation can continue'));
 assert.ok(!body.blockers.includes('Shopify Storefront API connection unverified'));
});
test('complete read-only diagnostics pass without claiming live acceptance',async()=>{
 const {body}=await run(launchEnv,async()=>null,services());
 assert.deepEqual(body.blockers,[]);assert.equal(body.prelaunchReady,true);
 assert.equal(body.readyForLive,false);assert.equal(body.liveIntegrationVerified,false);
 assert.ok(body.remainingLiveVerification.length>0);
});
for(const [failure,reason] of [
 ['admin','Shopify Admin API connection unverified'],
 ['scope','Shopify fulfillment write scope unverified'],
 ['webhook','Shopify ORDERS_PAID webhook registration unverified'],
 ['cj','CJ API connection unverified'],
 ['redis','Redis']
])test('release blocks and explains unavailable '+failure,async()=>{
 const {body}=await run(launchEnv,async()=>null,services(failure));
 assert.equal(body.prelaunchReady,false);assert.equal(body.safeToTest,false);
 assert.ok(body.blockers.includes(reason));
 assert.ok(!JSON.stringify(body).includes('private-service-error'));
});

test('internal legal fields do not certify Shopify policy registration',async()=>{
 const base=services();
 const {body}=await run(launchEnv,async()=>null,async(url,options={})=>{
  const query=JSON.parse(options.body||'{}').query||'';
  if(query.includes('ReadinessShopPolicies'))return {ok:true,json:async()=>({data:{shop:{name:'ODDLY',shopPolicies:[{type:'PRIVACY_POLICY',body:'<p>Privacy information</p>'},{type:'REFUND_POLICY',body:'<p>&nbsp;</p>'}]}}})};
  return base(url,options);
 });
 assert.equal(body.legalReady,true);
 assert.equal(body.shopifyPolicyAudit.verified,true);
 assert.equal(body.shopifyPolicyAudit.storeNameMatches,true);
 assert.deepEqual(body.shopifyPolicyAudit.registeredTypes,['PRIVACY_POLICY']);
 assert.deepEqual(body.shopifyPolicyAudit.missingTypes,['REFUND_POLICY','SHIPPING_POLICY','TERMS_OF_SERVICE','LEGAL_NOTICE','CONTACT_INFORMATION']);
 assert.ok(body.remainingLiveVerification.includes('Shopifyポリシー未登録：REFUND_POLICY'));
 assert.equal(body.readyForLive,false);
});
test('policy query error remains unknown and is not reported as missing registration',async()=>{
 const base=services();
 const {body}=await run(launchEnv,async()=>null,async(url,options={})=>{
  const query=JSON.parse(options.body||'{}').query||'';
  if(query.includes('ReadinessShopPolicies'))return {ok:true,json:async()=>({errors:[{message:'access denied'}]})};
  return base(url,options);
 });
 assert.equal(body.shopifyPolicyAudit.verified,false);
 assert.deepEqual(body.shopifyPolicyAudit.missingTypes,[]);
 assert.ok(body.remainingLiveVerification.includes('Shopifyポリシーの実環境確認'));
});

test('delivery and market audit exposes actual coverage without changing merchant settings',async()=>{
 const base=services();
 const {body}=await run(launchEnv,async()=>null,async(url,options={})=>{
  const query=JSON.parse(options.body||'{}').query||'';
  if(query.includes('ReadinessDeliveryProfiles'))return {ok:true,json:async()=>({data:{deliveryProfiles:{pageInfo:{hasNextPage:false},nodes:[{name:'General',coversAllItems:false,locationsWithoutRatesCount:1,activeMethodDefinitionsCount:4,zoneCountryCount:28}]}}})};
  if(query.includes('ReadinessMarkets'))return {ok:true,json:async()=>({data:{markets:{pageInfo:{hasNextPage:false},nodes:[{name:'Japan',status:'ACTIVE',type:'REGION'}]}}})};
  return base(url,options);
 });
 assert.equal(body.shopifyDeliveryAudit.verified,true);
 assert.equal(body.shopifyDeliveryAudit.locationsWithoutRates,1);
 assert.equal(body.shopifyMarketsAudit.verified,true);
 assert.equal(body.shopifyMarketsAudit.activeCount,1);
 assert.ok(body.remainingLiveVerification.includes('Shopify配送料未設定のロケーション確認'));
 assert.equal(body.readyForLive,false);
});
test('partial delivery and market results are not verification',async()=>{
 const base=services();
 const {body}=await run(launchEnv,async()=>null,async(url,options={})=>{
  const query=JSON.parse(options.body||'{}').query||'';
  if(query.includes('ReadinessDeliveryProfiles'))return {ok:true,json:async()=>({data:{deliveryProfiles:{pageInfo:{hasNextPage:true},nodes:[]}}})};
  if(query.includes('ReadinessMarkets'))return {ok:true,json:async()=>({data:{markets:{pageInfo:{hasNextPage:true},nodes:[]}}})};
  return base(url,options);
 });
 assert.equal(body.shopifyDeliveryAudit.verified,false);
 assert.equal(body.shopifyMarketsAudit.verified,false);
 assert.ok(body.remainingLiveVerification.includes('Shopify配送設定の実環境確認'));
 assert.ok(body.remainingLiveVerification.includes('Shopify販売市場の実環境確認'));
});

test('OAuth requests only read access for new store audits and identifies missing grants',async()=>{
 const oauth=readFileSync(new URL('../api/shopify-auth.js',import.meta.url),'utf8');
 for(const scope of ['read_legal_policies','read_shipping','read_markets']){
  assert.ok(oauth.includes(scope));
  assert.ok(!oauth.includes(scope.replace('read_','write_')));
 }
 const {body}=await run(launchEnv,async()=>null,services());
 assert.equal(body.auditScopeStatus.verified,true);
 assert.deepEqual(body.auditScopeStatus.missing,['read_legal_policies','read_shipping','read_markets']);
 assert.ok(body.remainingLiveVerification.includes('Shopify監査権限不足：read_legal_policies'));
});
