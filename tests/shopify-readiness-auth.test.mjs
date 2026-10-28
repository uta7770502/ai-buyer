import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { redisConnection } from '../lib/redis-connection.js';

const source=readFileSync(new URL('../lib/routes/release-readiness.js',import.meta.url),'utf8')
  .replace("import { redisConnection } from '../redis-connection.js';",'')
  .replace("import { loadShopifySession } from '../shopify-session-store.js';",'').replace("import { loadLegalConfig } from '../legal-config-store.js';",'').replace('export default async function handler','async function handler')+'\nthis.handler=handler;';

function run(env={},loadLegalConfig=async()=>null){
  const context={loadShopifySession:async()=>null,loadLegalConfig,process:{env:{AI_BUYER_ADMIN_KEY:'test-admin-key',...env}},fetch:async()=>{throw Error('Network calls must not be made in this fixture')},AbortSignal,Date,Boolean,String,Number,RegExp};
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
