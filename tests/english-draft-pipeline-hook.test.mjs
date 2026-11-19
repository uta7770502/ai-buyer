import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareEnglishForSavedDraft} from '../lib/english-draft-pipeline-hook.js';
import {TRANSLATABLE_PRODUCT_QUERY} from '../lib/shopify-english-draft-sync.js';
const product={id:'gid://shopify/Product/123',status:'DRAFT',title:'犬用ボトル',descriptionHtml:'<p>500ml</p>'};
test('hook disabled by default without any network calls',async()=>{
 const result=await prepareEnglishForSavedDraft({product,env:{},shopifyGraphql:async()=>{throw Error('unexpected')}});
 assert.equal(result.status,'disabled');
 assert.equal(result.adminLocale,'ja');
});
test('hook skips non-draft products',async()=>{
 const result=await prepareEnglishForSavedDraft({product:{...product,status:'ACTIVE'},env:{ADPS_ENGLISH_TRANSLATIONS_DRY_RUN_ENABLED:'true'}});
 assert.equal(result.status,'skipped-non-draft');
});
test('hook reports missing credentials without breaking Japanese draft',async()=>{
 const result=await prepareEnglishForSavedDraft({product,env:{ADPS_ENGLISH_TRANSLATIONS_DRY_RUN_ENABLED:'true'}});
 assert.equal(result.status,'missing-translation-credentials');
});
test('enabled hook calls Gemini and Shopify read-only, never registers translations',async()=>{
 let writes=0;
 const fetchImpl=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({title:'Dog Bottle',description:'500ml bottle'})}]}}]})});
 const shopifyGraphql=async(query,variables)=>{
  if(query!==TRANSLATABLE_PRODUCT_QUERY){writes++;throw Error('unexpected Shopify write');}
  return {translatableResource:{resourceId:variables.resourceId,translatableContent:[{key:'title',digest:'a'},{key:'body_html',digest:'b'}]}};
 };
 const result=await prepareEnglishForSavedDraft({product,fetchImpl,shopifyGraphql,env:{ADPS_ENGLISH_TRANSLATIONS_DRY_RUN_ENABLED:'true',GEMINI_API_KEY:'mock'}});
 assert.equal(result.status,'dry-run-ready');
 assert.equal(result.registered,false);
 assert.equal(writes,0);
});

test('unverified shipping copy is blocked before Gemini or Shopify API calls',async()=>{
 let called=0;
 const result=await prepareEnglishForSavedDraft({
  product:{...product,descriptionHtml:'<p>送料目安: ¥696</p>'},
  env:{ADPS_ENGLISH_TRANSLATIONS_DRY_RUN_ENABLED:'true',GEMINI_API_KEY:'mock'},
  fetchImpl:async()=>{called++;throw Error('Gemini must not be called');},
  shopifyGraphql:async()=>{called++;throw Error('Shopify must not be called');}
 });
 assert.equal(result.status,'source-review-required');
 assert.equal(result.registered,false);
 assert.equal(called,0);
});

test('recognized shipping boilerplate is removed before Gemini, while Shopify remains read-only',async()=>{
 let sourceText='';
 const fetchImpl=async(_url,options)=>{
  sourceText=JSON.stringify(options.body);
  return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({title:'Dog Water Bottle',description:'Portable 800ml bottle for dog walks.'})}]}}]})};
 };
 let writes=0;
 const shopifyGraphql=async(query,variables)=>{
  if(query!==TRANSLATABLE_PRODUCT_QUERY){writes++;throw Error('write attempted');}
  return {translatableResource:{resourceId:variables.resourceId,translatableContent:[{key:'title',digest:'a'},{key:'body_html',digest:'b'}]}};
 };
 const result=await prepareEnglishForSavedDraft({
  product:{...product,descriptionHtml:'犬との散歩に使う800mlボトルです。送料目安: ¥696'},
  env:{ADPS_ENGLISH_TRANSLATIONS_DRY_RUN_ENABLED:'true',GEMINI_API_KEY:'mock'},
  fetchImpl,shopifyGraphql
 });
 assert.equal(result.status,'dry-run-ready');
 assert.equal(writes,0);
 assert.equal(sourceText.includes('¥696'),false);
 assert.equal(sourceText.includes('800ml'),true);
});
