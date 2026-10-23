import test from 'node:test';
import assert from 'node:assert/strict';
import {findLegalPageCandidates,compareLegalPage} from '../lib/legal-sync-diff.js';
import {legalSyncReadiness} from '../lib/legal-sync-readiness.js';

test('only the intended legal notice page is matched',()=>{
 const pages=[
  {id:'gid://shopify/Page/1',title:'会社概要',handle:'about',body:'会社概要'},
  {id:'gid://shopify/Page/2',title:'特定商取引法に基づく表記',handle:'legal-notice',body:'<p>現行内容</p>'},
  {id:'gid://shopify/Page/3',title:'プライバシーポリシー',handle:'privacy-policy',body:'privacy'}
 ];
 const matches=findLegalPageCandidates(pages);
 assert.equal(matches.length,1);
 assert.equal(matches[0].id,'gid://shopify/Page/2');
 assert.equal(compareLegalPage(matches[0].body,'<p>現行内容</p>').changed,false);
});
test('different legal content must require manual review, never auto overwrite',()=>{
 const diff=compareLegalPage('<p>旧情報</p>','<p>新情報</p>');
 assert.equal(diff.changed,true);
 assert.equal(diff.requiresReview,true);
 assert.equal(diff.safeToAutoOverwrite,false);
});
test('missing or duplicate legal pages fail readiness',()=>{
 assert.equal(legalSyncReadiness({legalReady:true,shopConnected:true,pageCount:0}).ready,false);
 assert.equal(legalSyncReadiness({legalReady:true,shopConnected:true,pageCount:2}).ready,false);
});
