import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../lib/routes/shopify-legal-preview.js',import.meta.url),'utf8');
test('legal preview is read-only and requires exact match before ready',()=>{
  assert.match(code,/ready:complete&&readiness\.ready&&comparison\?\.changed===false/);
  assert.match(code,/changedShopify:false,automaticPublish:false/);
  assert.doesNotMatch(code,/mutation\s+\w+\s*\{/);
});

test('legal preview requires admin authorization before loading stored data',()=>{
  const authCheck=code.indexOf("req.headers?.authorization!=='Bearer '+admin");
  const legalLoad=code.indexOf('await loadLegalConfig()');
  assert.ok(authCheck>=0&&legalLoad>authCheck);
});
test('legal preview refuses incomplete pagination and mismatched content',()=>{
  assert.match(code,/pages\.pageInfo\?\.hasNextPage===false/);
  assert.match(code,/legal_content_mismatch/);
  assert.match(code,/reason:'read_only_inspection_failed'/);
});

test('legal preview refuses non-POST requests and absent admin key',async()=>{
  const {default:handler}=await import('../lib/routes/shopify-legal-preview.js');
  const previous=process.env.AI_BUYER_ADMIN_KEY;
  try{
    delete process.env.AI_BUYER_ADMIN_KEY;
    const invoke=async(method)=>{const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}};await handler({method,headers:{},query:{}},res);return res};
    const get=await invoke('GET');assert.equal(get.statusCode,405);
    const post=await invoke('POST');assert.equal(post.statusCode,401);
    assert.equal(post.body.ok,false);
  }finally{
    if(previous===undefined)delete process.env.AI_BUYER_ADMIN_KEY;
    else process.env.AI_BUYER_ADMIN_KEY=previous;
  }
});
