import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareProductTranslations, validateShopifyTranslationDigests } from '../lib/product-localization-preflight.js';

const product = {id:'gid://shopify/Product/123',status:'DRAFT',title:'犬用ボトル',descriptionHtml:'<p>犬用ウォーターボトル</p>'};
const translated = {title:'Portable Dog Water Bottle',description:'A portable water bottle for dogs.'};

test('prepares English draft without registering or publishing',()=>{
  const result=prepareProductTranslations(product,translated);
  assert.equal(result.targetLocale,'en');
  assert.equal(result.publishAllowed,false);
  assert.equal(result.registrationPerformed,false);
  assert.equal(result.needsShopifyTranslationDigest,true);
});
test('blocks non-draft product',()=>{
  assert.throws(()=>prepareProductTranslations({...product,status:'ACTIVE'},translated),/Only draft/);
});
test('blocks unsupported or same-language translation',()=>{
  assert.throws(()=>prepareProductTranslations(product,translated,{targetLocale:'fr'}),/Unsupported/);
  assert.throws(()=>prepareProductTranslations(product,translated,{targetLocale:'ja'}),/Unsupported/);
});
test('requires content and prevents unverified claims',()=>{
  assert.throws(()=>prepareProductTranslations(product,{...translated,shippingClaims:'2-day shipping'}),/require verification/);
  assert.throws(()=>prepareProductTranslations(product,{title:'',description:'test'}),/required/);
});
test('validates Shopify digest metadata before later registration',()=>{
  assert.deepEqual(validateShopifyTranslationDigests([{key:'title',digest:'abc'}]),[{key:'title',digest:'abc'}]);
  assert.throws(()=>validateShopifyTranslationDigests([{key:'title',digest:''}]),/digest/);
});
