import assert from 'node:assert/strict';
import test from 'node:test';
import {compareLegalPage, findLegalPageCandidates} from '../lib/legal-sync-diff.js';
import {legalSyncReadiness} from '../lib/legal-sync-readiness.js';

test('legal page differences never permit automatic overwrite', () => {
  assert.deepEqual(compareLegalPage('<p>old</p>', '<p>new</p>'), {
    changed:true,currentEmpty:false,proposedEmpty:false,
    requiresReview:true,safeToAutoOverwrite:false
  });
});
test('identical legal page needs no review', () => {
  assert.equal(compareLegalPage(' same ', 'same').changed,false);
});
test('duplicate legal pages are detected', () => {
  assert.equal(findLegalPageCandidates([
    {id:'1',handle:'legal-notice',title:'Notice'},
    {id:'2',handle:'other',title:'特定商取引法に基づく表記'}
  ]).length,2);
});
test('legal sync blocks ambiguous pages and incomplete configuration', () => {
  assert.equal(legalSyncReadiness({legalReady:true,shopConnected:true,pageCount:2}).ready,false);
  assert.equal(legalSyncReadiness({legalReady:false,shopConnected:true,pageCount:1}).ready,false);
  assert.equal(legalSyncReadiness({legalReady:true,shopConnected:true,pageCount:1}).automaticPublish,false);
});
