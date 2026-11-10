import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ui=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const api=readFileSync(new URL('../lib/routes/cj-search.js',import.meta.url),'utf8');

test('search diagnostics has an accessible live region',()=>{
  assert.match(ui,/id="cjSearchDiagnostics"[^>]*role="status"[^>]*aria-live="polite"/);
});
test('search UI shows each funnel exclusion and final candidate count',()=>{
  for(const key of ['receivedFromCJ','missingProductId','duplicateIds','excludedByListingCount','excludedByDiscoveryInventory','returnedCandidates','zeroResultReason']){
    assert.ok(ui.includes(key), 'missing UI diagnostic field: '+key);
  }
});
test('search UI explicitly reports unknown counts on connection failure',()=>{
  assert.match(ui,/取得数・除外数は未確定です。推定値で登録を許可しません/);
});
test('search API does not mark discovery-only products as draft ready',()=>{
  assert.match(api,/readyForShopifyDraft:\s*false/);
  assert.match(api,/freightVerified:\s*false/);
  assert.match(api,/profitVerified:\s*false/);
});
test('search API rejects invalid pagination and thresholds',()=>{
  assert.match(api,/Invalid pagination/);
  assert.match(api,/Invalid discovery threshold/);
  assert.match(api,/readyForShopifyDraft:\s*false/);
});
