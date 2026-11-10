const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test('CJ search rejects malformed filter thresholds before any network call',async()=>{
  const {default:handler}=await import(pathToFileURL(path.resolve(__dirname,'../lib/routes/cj-search.js')).href);
  const previousFetch=global.fetch;
  let calls=0;
  global.fetch=async()=>{calls++;throw Error('unexpected network access')};
  try {
    for(const value of ['NaN','Infinity','-1','5.5','1000001','abc']) {
      const req={method:'GET',query:{q:'pet',minVerifiedInventory:value}};
      const res={statusCode:200,status(n){this.statusCode=n;return this},json(v){this.body=v;return this}};
      await handler(req,res);
      assert.equal(res.statusCode,400,value);
      assert.equal(res.body.diagnostics.readyForShopifyDraft,false);
    }
    assert.equal(calls,0);
  } finally {global.fetch=previousFetch}
});

test('CJ authentication or network failure is unknown, never a verified zero result',async()=>{
  const {default:handler}=await import(pathToFileURL(path.resolve(__dirname,'../lib/routes/cj-search.js')).href);
  const oldFetch=global.fetch;
  const oldKey=process.env.CJ_API_KEY;
  const oldToken=process.env.CJ_ACCESS_TOKEN;
  delete process.env.CJ_API_KEY;
  delete process.env.CJ_ACCESS_TOKEN;
  global.fetch=async()=>{throw Error('network failure')};
  try {
    const req={method:'GET',query:{q:'pet'}};
    const res={statusCode:200,status(n){this.statusCode=n;return this},json(v){this.body=v;return this}};
    await handler(req,res);
    assert.equal(res.statusCode,502);
    assert.equal(res.body.ok,false);
    assert.equal(res.body.diagnostics.receivedFromCJ,null);
    assert.equal(res.body.diagnostics.returnedCandidates,null);
    assert.equal(res.body.diagnostics.readyForShopifyDraft,false);
    assert.equal(res.body.diagnostics.reason,'cj_request_failed');
  } finally {
    global.fetch=oldFetch;
    if(oldKey===undefined) delete process.env.CJ_API_KEY; else process.env.CJ_API_KEY=oldKey;
    if(oldToken===undefined) delete process.env.CJ_ACCESS_TOKEN; else process.env.CJ_ACCESS_TOKEN=oldToken;
  }
});

test('CJ HTTP success with unknown product schema is not reported as zero matches',async()=>{
  const {default:handler}=await import(pathToFileURL(path.resolve(__dirname,'../lib/routes/cj-search.js')).href);
  const oldFetch=global.fetch;
  const oldKey=process.env.CJ_API_KEY;
  const oldToken=process.env.CJ_ACCESS_TOKEN;
  delete process.env.CJ_API_KEY;
  process.env.CJ_ACCESS_TOKEN='test-token';
  global.fetch=async()=>({ok:true,status:200,json:async()=>({result:true,data:{unexpectedProducts:[]}})});
  try {
    const req={method:'GET',query:{q:'pet'}};
    const res={statusCode:200,status(n){this.statusCode=n;return this},json(v){this.body=v;return this}};
    await handler(req,res);
    assert.equal(res.statusCode,502);
    assert.equal(res.body.diagnostics.reason,'cj_response_schema_unrecognized');
    assert.equal(res.body.diagnostics.receivedFromCJ,null);
    assert.equal(res.body.diagnostics.readyForShopifyDraft,false);
  } finally {
    global.fetch=oldFetch;
    if(oldKey===undefined) delete process.env.CJ_API_KEY; else process.env.CJ_API_KEY=oldKey;
    if(oldToken===undefined) delete process.env.CJ_ACCESS_TOKEN; else process.env.CJ_ACCESS_TOKEN=oldToken;
  }
});
