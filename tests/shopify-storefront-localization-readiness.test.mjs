import test from 'node:test';
import assert from 'node:assert/strict';
import {STOREFRONT_LOCALIZATION_QUERY,summarizeShopifyLocalization,storefrontLanguageActionPlan} from '../lib/shopify-storefront-localization-readiness.js';

const data={
 shopLocales:[{locale:'ja',primary:true,published:true},{locale:'en',primary:false,published:false}],
 markets:{nodes:[
  {enabled:true,regions:{nodes:[{code:'JP'}]}},
  {enabled:false,regions:{nodes:[{code:'US'}]}}
 ]}
};
test('Shopify audit is read-only and does not confuse configured with published locales',()=>{
 const summary=summarizeShopifyLocalization(data);
 assert.deepEqual(summary.publishedLocales,['ja']);
 assert.deepEqual(summary.activeMarkets,['JP']);
 assert.equal(summary.adminLocale,'ja');
 assert.equal(summary.readOnly,true);
 assert.match(STOREFRONT_LOCALIZATION_QUERY,/shopLocales/);
});
test('inactive overseas markets do not count as active',()=>{
 const plan=storefrontLanguageActionPlan(summarizeShopifyLocalization(data),false);
 assert.equal(plan.canEnableEnglishExperience,false);
 assert.equal(plan.changesApplied,false);
 assert.equal(plan.missing.length,3);
});
test('all readiness conditions produce a plan, not a live activation',()=>{
 const summary=summarizeShopifyLocalization({
  shopLocales:[{locale:'ja',published:true},{locale:'en',published:true}],
  markets:{nodes:[{enabled:true,regions:{nodes:[{code:'US'}]}}]}
 });
 const plan=storefrontLanguageActionPlan(summary,true);
 assert.equal(plan.canEnableEnglishExperience,true);
 assert.equal(plan.changesApplied,false);
});
test('rejects incomplete Shopify responses',()=>{
 assert.throws(()=>summarizeShopifyLocalization({}),/required/);
});
