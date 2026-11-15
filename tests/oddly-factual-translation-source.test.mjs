import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareFactualTranslationSource} from '../lib/oddly-factual-translation-source.js';
test('removes unverified shipping estimate, return reference and price',()=>{
 const r=prepareFactualTranslationSource({title:'犬用ボトル',description:'犬との散歩に使う800mlボトルです。ご購入前に送料目安: ¥696返品条件はストアポリシーをご確認ください。販売価格: ¥1,800ご注文後、仕入先の在庫・価格・配送状況を確認して手配します。'});
 assert.equal(r.readyForTranslation,true);
 assert.equal(r.description,'犬との散歩に使う800mlボトルです。');
});
test('blocks unknown pet suitability rather than deleting the warning',()=>{
 const r=prepareFactualTranslationSource({title:'アリ型おもちゃ',description:'犬・猫向けの使用適性は未確認のため、販売準備中です。'});
 assert.equal(r.readyForTranslation,false);
 assert.ok(r.reviewReasons.includes('unverified-claims-remain'));
});
test('rejects incomplete source descriptions',()=>{
 assert.throws(()=>prepareFactualTranslationSource({title:'犬用ボトル',description:''}),/required/);
});

test('blocks truncated Shopify descriptions rather than treating fragments as verified facts',()=>{
 const r=prepareFactualTranslationSource({title:'猫用おもちゃ',description:'猫用のボールおもちゃです。日本向け送料目安: ¥1011販売価格・仕入先在庫・配送状況は変動するため、ご注...'});
 assert.equal(r.readyForTranslation,false);
 assert.ok(r.reviewReasons.includes('possibly-truncated-source'));
});
