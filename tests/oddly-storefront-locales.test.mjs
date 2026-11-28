import test from 'node:test';
import assert from 'node:assert/strict';
import {ADPS_ADMIN_LOCALE,resolveOddlyStorefrontLocale,verifyStorefrontLocalizationReadiness} from '../lib/oddly-storefront-locales.js';

test('ADPS admin is always Japanese',()=>{
 assert.equal(ADPS_ADMIN_LOCALE,'ja');
 for(const countryCode of ['JP','US','AU','SG','GB','CA']){
   assert.equal(resolveOddlyStorefrontLocale({countryCode}).adminLocale,'ja');
 }
});
test('Japanese customers get Japanese; supported overseas regions prefer English',()=>{
 assert.equal(resolveOddlyStorefrontLocale({countryCode:'JP'}).locale,'ja');
 assert.equal(resolveOddlyStorefrontLocale({countryCode:'US'}).locale,'en');
 assert.equal(resolveOddlyStorefrontLocale({countryCode:'AU'}).locale,'en');
});
test('customer selection overrides region preference',()=>{
 assert.equal(resolveOddlyStorefrontLocale({countryCode:'US',selectedLocale:'ja'}).locale,'ja');
 assert.throws(()=>resolveOddlyStorefrontLocale({selectedLocale:'fr'}),/not supported/);
});
test('English is not selected when it is unavailable',()=>{
 assert.equal(resolveOddlyStorefrontLocale({countryCode:'US',supportedLocales:['ja']}).locale,'ja');
});
test('readiness blocks missing locale, review and active markets',()=>{
 const result=verifyStorefrontLocalizationReadiness({publishedLocales:['ja'],activeMarkets:[],translatedContentReady:false});
 assert.equal(result.ready,false);
 assert.equal(result.issues.length,3);
 const ready=verifyStorefrontLocalizationReadiness({publishedLocales:['ja','en'],activeMarkets:['US'],translatedContentReady:true});
 assert.equal(ready.ready,true);
});
