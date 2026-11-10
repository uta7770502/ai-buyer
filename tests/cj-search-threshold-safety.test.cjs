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
