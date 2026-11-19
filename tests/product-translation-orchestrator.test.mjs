import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFingerprint, needsTranslationRefresh, buildEnglishTranslationRequest, generateEnglishDraft } from '../lib/product-translation-orchestrator.js';

const product={id:'gid://shopify/Product/123',status:'DRAFT',title:'犬用ボトル',descriptionHtml:'<p>容量500ml</p>'};
const provider=async () => ({title:'Dog Water Bottle',description:'500 ml dog water bottle.'});

test('translation request includes guardrails and languages',()=>{
 const request=buildEnglishTranslationRequest(product);
 assert.equal(request.sourceLocale,'ja');
 assert.equal(request.targetLocale,'en');
 assert.match(request.instructions.join(' '),/Do not invent shipping speed/);
});
test('detects source edits before retranslation',()=>{
 const fp=sourceFingerprint(product);
 assert.equal(needsTranslationRefresh(product,fp),false);
 assert.equal(needsTranslationRefresh({...product,title:'新商品'},fp),true);
});
test('generates a non-publishing English draft using injected provider',async()=>{
 const draft=await generateEnglishDraft(product,provider);
 assert.equal(draft.proposed.title,'Dog Water Bottle');
 assert.equal(draft.translationGenerated,true);
 assert.equal(draft.publishAllowed,false);
});
test('blocks missing provider, empty response and active products',async()=>{
 await assert.rejects(generateEnglishDraft(product,null),/provider function required/);
 await assert.rejects(generateEnglishDraft(product,async()=>({title:'',description:''})),/incomplete output/);
 await assert.rejects(generateEnglishDraft({...product,status:'ACTIVE'},provider),/Only valid Shopify draft/);
});
