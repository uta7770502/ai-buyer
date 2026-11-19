import test from 'node:test';
import assert from 'node:assert/strict';
import {auditEnglishLocalizationCandidates} from '../lib/oddly-localization-catalog-audit.js';
const p={id:'gid://shopify/Product/123',status:'DRAFT',title:'犬用ボトル',description:'犬用のボトルです。',shopifyInventory:5};
test('draft with verified copy and positive Shopify inventory passes audit',()=>{
 const r=auditEnglishLocalizationCandidates([p]);assert.equal(r.launchReadyCount,1);assert.equal(r.translationReviewCount,0);
});
test('shipping estimates and zero inventory block launch without treating CJ stock as zero',()=>{
 const r=auditEnglishLocalizationCandidates([{...p,description:'送料目安: ¥696',shopifyInventory:0}]);
 assert.equal(r.launchReadyCount,0);assert.deepEqual(r.items[0].reasons,['unverified-commercial-or-suitability-copy','shopify-inventory-not-positive']);
});
test('unverified pet suitability requires review',()=>{
 const r=auditEnglishLocalizationCandidates([{...p,description:'犬・猫向けの使用適性は未確認',shopifyInventory:10}]);
 assert.equal(r.translationReviewCount,1);
});
test('active and duplicate entries fail safely',()=>{
 const r=auditEnglishLocalizationCandidates([p,{...p,status:'ACTIVE'}]);assert.equal(r.launchReadyCount,1);
 assert.ok(r.items[1].reasons.includes('duplicate-product'));
 assert.ok(r.items[1].reasons.includes('not-draft'));
});
