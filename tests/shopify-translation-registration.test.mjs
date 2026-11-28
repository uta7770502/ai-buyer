import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareProductTranslations} from '../lib/product-localization-preflight.js';
import {buildProductTranslationRegistration, SHOPIFY_TRANSLATIONS_REGISTER} from '../lib/shopify-translation-registration.js';

const product={id:'gid://shopify/Product/123',status:'DRAFT',title:'犬用ボトル',descriptionHtml:'<p>説明</p>'};
const draft=prepareProductTranslations(product,{title:'Dog Water Bottle',description:'Portable bottle for dogs'});
const digests=[{key:'title',digest:'digest-title'},{key:'body_html',digest:'digest-body'}];
test('builds Shopify translation input without executing it',()=>{
 const result=buildProductTranslationRegistration(draft,digests,{approved:true});
 assert.equal(result.executed,false);
 assert.equal(result.publishAllowed,false);
 assert.match(SHOPIFY_TRANSLATIONS_REGISTER,/translationsRegister/);
 assert.deepEqual(result.variables.translations.map(t=>t.key),['title','body_html']);
 assert.equal(result.variables.translations[0].translatableContentDigest,'digest-title');
});
test('requires explicit registration approval',()=>{
 assert.throws(()=>buildProductTranslationRegistration(draft,digests),/approval required/);
});
test('rejects absent, duplicate or unexpected digests',()=>{
 assert.throws(()=>buildProductTranslationRegistration(draft,[],{approved:true}),/Missing/);
 assert.throws(()=>buildProductTranslationRegistration(draft,[...digests,digests[0]],{approved:true}),/duplicate/);
 assert.throws(()=>buildProductTranslationRegistration(draft,[...digests,{key:'handle',digest:'x'}],{approved:true}),/unsupported/);
});
test('rejects tampered preflight',()=>{
 assert.throws(()=>buildProductTranslationRegistration({...draft,publishAllowed:true},digests,{approved:true}),/safe translation preflight/);
});
