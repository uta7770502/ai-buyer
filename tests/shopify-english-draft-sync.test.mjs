import test from 'node:test';
import assert from 'node:assert/strict';
import {syncEnglishProductDraft,TRANSLATABLE_PRODUCT_QUERY} from '../lib/shopify-english-draft-sync.js';

const product={id:'gid://shopify/Product/123',status:'DRAFT',title:'犬用ボトル',descriptionHtml:'<p>犬用</p>'};
const translator=async()=>({title:'Dog Water Bottle',description:'Water bottle for dogs'});
let writes=0;
const shopify=async(query,vars)=>{
 if(query===TRANSLATABLE_PRODUCT_QUERY) return {data:{translatableResource:{
  resourceId:vars.resourceId,translatableContent:[
   {key:'title',digest:'a'},{key:'body_html',digest:'b'}
  ]
 }}};
 writes++;
 return {data:{translationsRegister:{userErrors:[],translations:[]}}};
};

test('approved dry-run never writes translations',async()=>{
 writes=0;
 const result=await syncEnglishProductDraft({product,translator,shopifyGraphql:shopify,approved:true});
 assert.equal(result.registered,false);
 assert.equal(result.translationCount,2);
 assert.equal(writes,0);
});
test('unapproved translation cannot be registered',async()=>{
 writes=0;
 await assert.rejects(syncEnglishProductDraft({product,translator,shopifyGraphql:shopify}),/approval required/);
 assert.equal(writes,0);
});
test('write gate blocks apply by default',async()=>{
 writes=0;
 const previous=process.env.ADPS_ENGLISH_TRANSLATIONS_WRITE_ENABLED;
 delete process.env.ADPS_ENGLISH_TRANSLATIONS_WRITE_ENABLED;
 try {
  await assert.rejects(syncEnglishProductDraft({product,translator,shopifyGraphql:shopify,approved:true,apply:true}),/writes are disabled/);
  assert.equal(writes,0);
 } finally {
  if(previous===undefined) delete process.env.ADPS_ENGLISH_TRANSLATIONS_WRITE_ENABLED;
  else process.env.ADPS_ENGLISH_TRANSLATIONS_WRITE_ENABLED=previous;
 }
});
test('rejects Shopify resource mismatch',async()=>{
 const bad=async()=>({data:{translatableResource:{resourceId:'gid://shopify/Product/999',translatableContent:[]}}});
 await assert.rejects(syncEnglishProductDraft({product,translator,shopifyGraphql:bad,approved:true}),/mismatch/);
});
test('never translates active products',async()=>{
 await assert.rejects(syncEnglishProductDraft({product:{...product,status:'ACTIVE'},translator,shopifyGraphql:shopify,approved:true}),/Only valid Shopify draft/);
});
