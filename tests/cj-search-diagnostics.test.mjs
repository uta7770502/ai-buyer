import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-search.js';

function response() {
  return { code: 200, headers: {}, status(n) { this.code=n; return this; }, setHeader(k,v) { this.headers[k]=v; return this; }, json(v) { this.body=v; return this; } };
}

test('CJ search reports each discovery exclusion without granting safety verification', async () => {
  const originalFetch=globalThis.fetch;
  const originalToken=process.env.CJ_ACCESS_TOKEN;
  const originalKey=process.env.CJ_API_KEY;
  process.env.CJ_ACCESS_TOKEN='test-only-token';
  delete process.env.CJ_API_KEY;
  globalThis.fetch=async () => ({ok:true,json:async()=>({result:true,data:{list:[
    {id:'a',listedNum:10,totalVerifiedInventory:8},
    {id:'a',listedNum:10,totalVerifiedInventory:8},
    {id:'b',listedNum:2,totalVerifiedInventory:9},
    {id:'c',listedNum:10,totalVerifiedInventory:2},
    {id:'d',listedNum:10},
    {listedNum:10,totalVerifiedInventory:9}
  ],total:6}})});
  try {
    const res=response();
    await handler({method:'GET',query:{q:'pet',minListed:'5',minVerifiedInventory:'5'}},res);
    assert.equal(res.code,200);
    assert.deepEqual(res.body.products.map(p=>p.id),['a']);
    assert.deepEqual({
      received:res.body.diagnostics.receivedFromCJ,
      missing:res.body.diagnostics.missingProductId,
      duplicates:res.body.diagnostics.duplicateIds,
      listing:res.body.diagnostics.excludedByListingCount,
      inventory:res.body.diagnostics.excludedByDiscoveryInventory,
      returned:res.body.diagnostics.returnedCandidates
    },{received:6,missing:1,duplicates:1,listing:1,inventory:2,returned:1});
    assert.equal(res.body.diagnostics.variantStockVerified,false);
    assert.equal(res.body.diagnostics.netProfitVerified,false);
    assert.equal(res.body.products[0].readyForShopifyDraft,false);
  } finally {
    globalThis.fetch=originalFetch;
    if(originalToken===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=originalToken;
    if(originalKey===undefined)delete process.env.CJ_API_KEY;else process.env.CJ_API_KEY=originalKey;
  }
});
