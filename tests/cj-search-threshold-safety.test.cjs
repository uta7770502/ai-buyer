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

test('CJ search upstream rejection and invalid JSON remain unknown and redact supplier messages',async()=>{
  const {default:handler}=await import(pathToFileURL(path.resolve(__dirname,'../lib/routes/cj-search.js')).href);
  const oldFetch=global.fetch,oldKey=process.env.CJ_API_KEY,oldToken=process.env.CJ_ACCESS_TOKEN;
  delete process.env.CJ_API_KEY;process.env.CJ_ACCESS_TOKEN='test-token';
  try{
    for(const scenario of [
      {status:401,ok:false,body:{result:false,message:'secret-token-in-upstream-error'},reason:'cj_upstream_http_error'},
      {status:200,ok:true,body:{result:false,message:'secret-token-in-upstream-error'},reason:'cj_upstream_rejected'},
      {status:200,ok:true,body:null,reason:'cj_response_json_invalid'}
    ]){
      global.fetch=async()=>({status:scenario.status,ok:scenario.ok,json:async()=>{if(scenario.body===null)throw Error('invalid json');return scenario.body;}});
      const req={method:'GET',query:{q:'pet'}};
      const res={statusCode:200,status(n){this.statusCode=n;return this},json(v){this.body=v;return this}};
      await handler(req,res);
      assert.equal(res.statusCode,502);
      assert.equal(res.body.diagnostics.reason,scenario.reason);
      assert.equal(res.body.diagnostics.upstreamStatus,scenario.status);
      assert.equal(res.body.diagnostics.receivedFromCJ,null);
      assert.equal(res.body.diagnostics.readyForShopifyDraft,false);
      assert.doesNotMatch(JSON.stringify(res.body),/secret-token-in-upstream-error/);
    }
  }finally{
    global.fetch=oldFetch;
    if(oldKey===undefined)delete process.env.CJ_API_KEY;else process.env.CJ_API_KEY=oldKey;
    if(oldToken===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=oldToken;
  }
});


test('CJ search normalizes productId and pid without promoting discovery to verified inventory',async()=>{
  const {default:handler}=await import(pathToFileURL(path.resolve(__dirname,'../lib/routes/cj-search.js')).href);
  const oldFetch=global.fetch,oldKey=process.env.CJ_API_KEY,oldToken=process.env.CJ_ACCESS_TOKEN;
  delete process.env.CJ_API_KEY;process.env.CJ_ACCESS_TOKEN='test-token';
  global.fetch=async()=>({ok:true,status:200,json:async()=>({result:true,data:{list:[
    {productId:'product-from-productId',nameEn:'A',totalVerifiedInventory:100},
    {pid:'product-from-pid',nameEn:'B',totalVerifiedInventory:100}
  ],total:2}})});
  try{
    const res={statusCode:200,status(n){this.statusCode=n;return this},setHeader(){},json(v){this.body=v;return this}};
    await handler({method:'GET',query:{q:'pet'}},res);
    assert.equal(res.statusCode,200);
    assert.deepEqual(res.body.products.map(p=>p.id),['product-from-productId','product-from-pid']);
    for(const p of res.body.products){
      assert.equal(p.variantInventoryVerified,false);
      assert.equal(p.freightVerified,false);
      assert.equal(p.profitVerified,false);
      assert.equal(p.readyForShopifyDraft,false);
    }
  }finally{
    global.fetch=oldFetch;
    if(oldKey===undefined)delete process.env.CJ_API_KEY;else process.env.CJ_API_KEY=oldKey;
    if(oldToken===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=oldToken;
  }
});

test('CJ search rejects malformed pagination without upstream requests',async()=>{
  const {default:handler}=await import(pathToFileURL(path.resolve(__dirname,'../lib/routes/cj-search.js')).href);
  const oldFetch=global.fetch;
  let calls=0;global.fetch=async()=>{calls++;throw Error('unexpected network')};
  try{
    for(const query of [{page:'0'},{page:'1.5'},{page:'Infinity'},{size:'51'},{size:'-1'}]){
      const res={statusCode:200,status(n){this.statusCode=n;return this},json(v){this.body=v;return this}};
      await handler({method:'GET',query:{q:'pet',...query}},res);
      assert.equal(res.statusCode,400);
      assert.equal(res.body.diagnostics.readyForShopifyDraft,false);
    }
    assert.equal(calls,0);
  }finally{global.fetch=oldFetch}
});
