import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const storefront=fs.readFileSync(new URL('../lib/routes/storefront-config.js',import.meta.url),'utf8');
const readiness=fs.readFileSync(new URL('../lib/routes/release-readiness.js',import.meta.url),'utf8');
const store=fs.readFileSync(new URL('../lib/legal-config-store.js',import.meta.url),'utf8');

test('legal config is admin-gated and encrypted at rest',()=>{
  assert.match(store,/aes-256-gcm/);
  assert.match(store,/ai-buyer:oddly:legal-config:v1/);
  assert.match(store,/SHOPIFY_TOKEN_ENCRYPTION_KEY/);
  assert.match(store,/UPSTASH_REDIS_REST_URL/);
  assert.match(store,/UPSTASH_REDIS_REST_TOKEN/);
  assert.match(store,/SET/);
  assert.match(store,/GET/);
  assert.match(storefront,/req\.method==='POST'/);
  assert.match(storefront,/Authorization|authorization/);
  assert.match(storefront,/AI_BUYER_ADMIN_KEY/);
  assert.match(storefront,/saveLegalConfig/);
  assert.match(storefront,/source:stored\?'encrypted-redis':'environment'/);
});

test('readiness consumes encrypted legal config before env fallback',()=>{
  assert.match(readiness,/loadLegalConfig/);
  assert.match(readiness,/legalValue\(legal\.sellerName,'ODDLY_SELLER_NAME'\)/);
  assert.match(readiness,/legalValue\(legal\.returnDays,'ODDLY_RETURN_DAYS'\)/);
  assert.match(readiness,/legalSource:Object\.keys\(legal\)\.length\?'encrypted-redis':'environment'/);
});

test('admin UI contains one-screen legal form and save flow',()=>{
  for(const id of ['legalSellerName','legalRepresentative','legalAddress','legalPhone','legalEmail','legalPaymentTiming','legalShippingWindow','legalReturnDays','legalReturnConditions','legalReturnShipping','legalAdditionalFees','legalPrivacyContact']){
    assert.match(index,new RegExp('id="'+id+'"'));
  }
  assert.match(index,/async function saveLegalAdminForm/);
  assert.match(index,/\/api\/storefront-config/);
  assert.match(index,/特商法・返品条件・返品日数を公開前チェックへ反映/);
});

test('saving legal data automatically reruns safe prelaunch checks',()=>{
  const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=index.indexOf('async function saveLegalAdminForm');
  const end=index.indexOf('async function runOneActionPrelaunch',start);
  const block=index.slice(start,end);
  assert.match(block,/await runOneActionPrelaunch\(\)/);
  assert.doesNotMatch(block,/ODDLY_CHECKOUT_ENABLED\s*=\s*true|SHOPIFY_LIVE_PUBLISH_ENABLED|removeStorefrontPassword|disablePasswordProtection/);
});

test('legal form can prefill read-only Shopify business contact data',()=>{
  const api=fs.readFileSync(new URL('../api/shopify-publish.js',import.meta.url),'utf8');
  const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(api,/legalPrefill===true/);
  assert.match(api,/shop \{ name contactEmail billingAddress/);
  assert.match(api,/source:'shopify-admin-read-only'/);
  assert.match(index,/Shopify店舗情報から基本情報を自動入力/);
  assert.match(index,/async function prefillLegalFromShopify/);
  assert.doesNotMatch(index.slice(index.indexOf('async function prefillLegalFromShopify'),index.indexOf('async function loadLegalAdminForm')),/ODDLY_CHECKOUT_ENABLED|SHOPIFY_LIVE_PUBLISH_ENABLED|removeStorefrontPassword/);
});

test('legal basics auto-prefill on load but are not auto-saved',()=>{
  const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(index,/if\(empty\)await prefillLegalFromShopify\(\)/);
  assert.match(index,/残り：/);
  const start=index.indexOf('setTimeout(async()=>');
  const end=index.indexOf('},700);',start);
  const boot=index.slice(start,end);
  assert.doesNotMatch(boot,/saveLegalAdminForm\(/);
});

test('legal copy suggestions are review-only and never auto-save',()=>{
  const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(index,/法務文面の候補を入力（保存はしない）/);
  assert.match(index,/function fillLegalSuggestedCopy/);
  const start=index.indexOf('function fillLegalSuggestedCopy');
  const end=index.indexOf('async function prefillLegalFromShopify',start);
  const block=index.slice(start,end);
  assert.doesNotMatch(block,/saveLegalAdminForm\(/);
  assert.doesNotMatch(block,/fetch\('/);
  assert.match(block,/実際の運用・配送条件・返品方針に合っているか確認/);
});

test('legal UI shows exact missing fields and blocks incomplete save',()=>{
  const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(index,/function updateLegalMissingSummary/);
  assert.match(index,/公開直前READYまで残り/);
  assert.match(index,/const missingBeforeSave=updateLegalMissingSummary\(\)/);
  assert.match(index,/未入力：/);
});
