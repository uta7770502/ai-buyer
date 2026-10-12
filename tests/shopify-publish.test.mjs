import test from 'node:test';
import assert from 'node:assert/strict';
import publish from '../api/shopify-publish.js';

async function invoke({method='POST',cookie='',allowed='test.myshopify.com',body={}}={}){
 const old=process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN;
 const previousFetch=globalThis.fetch;
 process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN=allowed;
 globalThis.fetch=async()=>{throw Error('Unexpected external request')};
 const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(v){this.body=v;return this}};
 try{await publish({method,headers:{cookie},body},res);return res}
 finally{globalThis.fetch=previousFetch;if(old===undefined)delete process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN;else process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN=old}
}

test('Shopify publish rejects non-POST requests before authentication',async()=>{
 const r=await invoke({method:'GET'});
 assert.equal(r.code,405);assert.equal(r.body.ok,false);
});
test('Shopify publish requires a connected shop session',async()=>{
 const r=await invoke();assert.equal(r.code,401);assert.equal(r.body.authRequired,true);
});
test('Shopify publish blocks a different shop even with a token',async()=>{
 const r=await invoke({cookie:'shopify_access_token=token; shopify_connected_shop=other.myshopify.com'});
 assert.equal(r.code,403);
});
test('Shopify publish rejects missing allowlist',async()=>{
 const r=await invoke({allowed:'',cookie:'shopify_access_token=token; shopify_connected_shop=test.myshopify.com'});
 assert.equal(r.code,403);
});

test('Shopify publish rejects missing product title without calling external APIs',async()=>{
 const r=await invoke({cookie:'shopify_access_token=token; shopify_connected_shop=test.myshopify.com',body:{price:1200,cjProductId:'cj-test'}});
 assert.equal(r.code,400);assert.match(r.body.error,/商品名/);
});
test('Shopify publish rejects zero, negative and nonfinite prices before CJ lookup',async()=>{
 for(const price of [0,-1,'NaN','Infinity']){
  const r=await invoke({cookie:'shopify_access_token=token; shopify_connected_shop=test.myshopify.com',body:{title:'Safe product',price,cjProductId:'cj-test'}});
  assert.equal(r.code,400);
 }
});

test('CJ product lookup failure prevents any Shopify draft creation',async()=>{
 const oldShop=process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN;
 const oldCj=process.env.CJ_ACCESS_TOKEN;
 const previousFetch=globalThis.fetch;
 const calls=[];
 process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN='test.myshopify.com';
 process.env.CJ_ACCESS_TOKEN='test-cj';
 globalThis.fetch=async(url)=>{
  calls.push(String(url));
  if(String(url).includes('developers.cjdropshipping.com/api2.0/v1/product/query'))return {ok:true,status:200,json:async()=>({result:false,message:'CJ product unavailable'})};
  throw Error('Shopify must not be called after CJ lookup failure');
 };
 const res={code:200,setHeader(){return this},status(n){this.code=n;return this},json(v){this.body=v;return this}};
 try{
  await publish({method:'POST',headers:{cookie:'shopify_access_token=token; shopify_connected_shop=test.myshopify.com'},body:{title:'Sample',price:1200,cjProductId:'cj-test'}},res);
  assert.equal(res.code,500);
  assert.match(res.body.error,/CJ product unavailable/);
  assert.equal(calls.length,1);
  assert.ok(calls.every(url=>!url.includes('myshopify.com')));
 }finally{
  globalThis.fetch=previousFetch;
  if(oldShop===undefined)delete process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN;else process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN=oldShop;
  if(oldCj===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=oldCj;
 }
});
