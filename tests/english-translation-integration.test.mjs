import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnglishTranslationProvider} from '../lib/gemini-english-translation-provider.js';
import {syncEnglishProductDraft,TRANSLATABLE_PRODUCT_QUERY} from '../lib/shopify-english-draft-sync.js';

const product={id:'gid://shopify/Product/123',status:'DRAFT',title:'犬用ボトル',descriptionHtml:'<p>500 ml</p>'};
const apiKey='mock-key';
let geminiCalls=0;
const translator=createEnglishTranslationProvider({apiKey,fetchImpl:async(url,request)=>{
 geminiCalls++;
 assert.match(url,/generateContent$/);
 assert.equal(request.headers['x-goog-api-key'],apiKey);
 const body=JSON.parse(request.body);
 assert.equal(body.generationConfig.responseMimeType,'application/json');
 return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({title:'Portable Dog Water Bottle',description:'500 ml portable water bottle for dogs.'})}]}}]})};
}});
let readCalls=0;
let writeCalls=0;
const shopify=async(query,variables)=>{
 if(query===TRANSLATABLE_PRODUCT_QUERY){
  readCalls++;
  return {data:{translatableResource:{resourceId:variables.resourceId,translatableContent:[
   {key:'title',digest:'digest-title'},{key:'body_html',digest:'digest-description'}
  ]}}};
 }
 writeCalls++;
 return {data:{translationsRegister:{userErrors:[],translations:[]}}};
};

test('Gemini to Shopify translation end-to-end dry-run makes no Shopify writes',async()=>{
 const result=await syncEnglishProductDraft({product,translator,shopifyGraphql:shopify,approved:true,apply:false});
 assert.equal(result.mode,'dry-run');
 assert.equal(result.registered,false);
 assert.equal(result.translationCount,2);
 assert.equal(geminiCalls,1);
 assert.equal(readCalls,1);
 assert.equal(writeCalls,0);
});

test('Gemini output cannot bypass draft-only safeguard',async()=>{
 await assert.rejects(syncEnglishProductDraft({product:{...product,status:'ACTIVE'},translator,shopifyGraphql:shopify,approved:true}),/Only valid Shopify draft/);
 assert.equal(writeCalls,0);
});

test('Shopify read failures prevent registration',async()=>{
 const failingShopify=async()=>({errors:[{message:'Access denied'}]});
 await assert.rejects(syncEnglishProductDraft({product,translator,shopifyGraphql:failingShopify,approved:true}),/Shopify GraphQL errors/);
 assert.equal(writeCalls,0);
});
