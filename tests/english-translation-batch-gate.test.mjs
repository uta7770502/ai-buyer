import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTranslationSyncBatch} from '../lib/english-translation-batch-gate.js';
const product=i=>({id:`gid://shopify/Product/${i}`,status:'DRAFT',title:`商品${i}`,descriptionHtml:'<p>説明</p>'});
test('accepts nine unique Shopify draft products without changing admin language',()=>{
 const result=validateTranslationSyncBatch(Array.from({length:9},(_,i)=>product(i+1)));
 assert.equal(result.productCount,9);
 assert.equal(result.mode,'dry-run');
 assert.equal(result.adminLocale,'ja');
 assert.equal(result.targetLocale,'en');
});
test('rejects a batch exceeding nine products',()=>{
 assert.throws(()=>validateTranslationSyncBatch(Array.from({length:10},(_,i)=>product(i+1))),/1 to 9/);
});
test('rejects duplicates and active products',()=>{
 assert.throws(()=>validateTranslationSyncBatch([product(1),product(1)]),/Duplicate/);
 assert.throws(()=>validateTranslationSyncBatch([{...product(1),status:'ACTIVE'}]),/draft/);
});
test('rejects incomplete source content',()=>{
 assert.throws(()=>validateTranslationSyncBatch([{...product(1),descriptionHtml:''}]),/required/);
});
