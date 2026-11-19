import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnglishTranslationProvider} from '../lib/gemini-english-translation-provider.js';
import {buildEnglishTranslationRequest} from '../lib/product-translation-orchestrator.js';

const request=buildEnglishTranslationRequest({id:'gid://shopify/Product/123',status:'DRAFT',title:'犬用ボトル',descriptionHtml:'<p>500ml</p>'});
test('Gemini adapter submits structured Japanese-to-English request',async()=>{
 let called=0;
 const provider=createEnglishTranslationProvider({apiKey:'test-only',fetchImpl:async(url,init)=>{
  called++;
  assert.match(url,/generateContent$/);
  assert.equal(init.headers['x-goog-api-key'],'test-only');
  assert.equal(JSON.parse(init.body).generationConfig.responseMimeType,'application/json');
  return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({title:'Dog Bottle',description:'500 ml'})}]}}]})};
 }});
 assert.deepEqual(await provider(request),{title:'Dog Bottle',description:'500 ml'});
 assert.equal(called,1);
});
test('provider rejects invalid or incomplete responses',async()=>{
 const provider=createEnglishTranslationProvider({apiKey:'test-only',fetchImpl:async()=>({ok:true,json:async()=>({candidates:[]})})});
 await assert.rejects(provider(request),/invalid JSON/);
});
test('provider refuses non-English requests',async()=>{
 const provider=createEnglishTranslationProvider({apiKey:'test-only',fetchImpl:async()=>{throw new Error('unexpected call')}});
 await assert.rejects(provider({...request,targetLocale:'fr'}),/Invalid Japanese-to-English/);
});
test('provider requires credentials and HTTPS',()=>{
 assert.throws(()=>createEnglishTranslationProvider({apiKey:''}),/API key/);
 assert.throws(()=>createEnglishTranslationProvider({apiKey:'x',endpoint:'http://example.com'}),/HTTPS/);
});
