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

test('valid CJ product creates Shopify draft but never publishes without approval',async()=>{
 const oldShop=process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN,oldCj=process.env.CJ_ACCESS_TOKEN,oldLive=process.env.SHOPIFY_LIVE_PUBLISH_ENABLED;
 const previousFetch=globalThis.fetch,requests=[];
 process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN='test.myshopify.com';
 process.env.CJ_ACCESS_TOKEN='test-cj';
 process.env.SHOPIFY_LIVE_PUBLISH_ENABLED='false';
 globalThis.fetch=async(url,opts={})=>{
  const u=String(url);
  if(u.includes('developers.cjdropshipping.com/api2.0/v1/product/query'))return {ok:true,status:200,json:async()=>({result:true,data:{pid:'cj-test',variants:[{vid:'cj-variant',variantSku:'CJ-001'}]}})};
  assert.match(u,/test\.myshopify\.com\/admin\/api\//);
  const data=JSON.parse(opts.body);requests.push(data);
  if(data.query.includes('ExistingDraftsBySku'))return {ok:true,json:async()=>({data:{products:{nodes:[],pageInfo:{hasNextPage:false}}}})};
  if(data.query.includes('CreateProduct'))return {ok:true,json:async()=>({data:{productCreate:{product:{id:'gid://shopify/Product/1',title:'Sample',handle:'sample',status:'DRAFT',variants:{nodes:[{id:'gid://shopify/ProductVariant/2'}]}},userErrors:[]}}})};
  if(data.query.includes('UpdateVariant'))return {ok:true,json:async()=>({data:{productVariantsBulkUpdate:{productVariants:[{id:'gid://shopify/ProductVariant/2',price:'1200'}],userErrors:[]}}})};
  throw Error('Unexpected Shopify mutation');
 };
 const res={code:200,setHeader(){return this},status(n){this.code=n;return this},json(v){this.body=v;return this}};
 try{
  await publish({method:'POST',headers:{cookie:'shopify_access_token=token; shopify_connected_shop=test.myshopify.com'},body:{title:'Sample',price:1200,cjProductId:'cj-test',publishApproved:true}},res);
  assert.equal(res.code,200);assert.equal(res.body.status,'DRAFT');assert.equal(res.body.published,false);
  assert.equal(requests.length,3);
  assert.equal(requests[1].variables.product.status,'DRAFT');
  assert.equal(requests[2].variables.variants[0].inventoryItem.sku,'cj-variant');
  assert.ok(requests.every(x=>!x.query.includes('publishablePublish')));
 }finally{
  globalThis.fetch=previousFetch;
  for(const [key,value] of [['SHOPIFY_ALLOWED_SHOP_DOMAIN',oldShop],['CJ_ACCESS_TOKEN',oldCj],['SHOPIFY_LIVE_PUBLISH_ENABLED',oldLive]]){if(value===undefined)delete process.env[key];else process.env[key]=value}
 }
});

test('duplicate CJ SKU drafts block creation before any Shopify mutation',async()=>{
 const oldShop=process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN,oldCj=process.env.CJ_ACCESS_TOKEN;
 const previousFetch=globalThis.fetch,queries=[];
 process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN='test.myshopify.com';
 process.env.CJ_ACCESS_TOKEN='test-cj';
 globalThis.fetch=async(url,opts={})=>{
  if(String(url).includes('developers.cjdropshipping.com/api2.0/v1/product/query'))return {ok:true,status:200,json:async()=>({result:true,data:{pid:'cj-test',variants:[{vid:'cj-variant'}]}})};
  const request=JSON.parse(opts.body);queries.push(request.query);
  assert.match(request.query,/ExistingDraftsBySku/);
  const draft=id=>({id:'gid://shopify/Product/'+id,status:'DRAFT',vendor:'AI BUYER',variants:{nodes:[{sku:'cj-variant'}],pageInfo:{hasNextPage:false}}});
  return {ok:true,json:async()=>({data:{products:{nodes:[draft(1),draft(2)],pageInfo:{hasNextPage:false}}}})};
 };
 const res={code:200,setHeader(){return this},status(n){this.code=n;return this},json(v){this.body=v;return this}};
 try{
  await publish({method:'POST',headers:{cookie:'shopify_access_token=token; shopify_connected_shop=test.myshopify.com'},body:{title:'Sample',price:1200,cjProductId:'cj-test'}},res);
  assert.equal(res.code,409);assert.match(res.body.error,/複数/);
  assert.equal(queries.length,1);
 }finally{
  globalThis.fetch=previousFetch;
  for(const [key,value] of [['SHOPIFY_ALLOWED_SHOP_DOMAIN',oldShop],['CJ_ACCESS_TOKEN',oldCj]]){if(value===undefined)delete process.env[key];else process.env[key]=value}
 }
});

test('single matching CJ SKU draft is updated rather than creating a duplicate',async()=>{
 const oldShop=process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN,oldCj=process.env.CJ_ACCESS_TOKEN,oldLive=process.env.SHOPIFY_LIVE_PUBLISH_ENABLED;
 const previousFetch=globalThis.fetch,queries=[];
 process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN='test.myshopify.com';
 process.env.CJ_ACCESS_TOKEN='test-cj';
 process.env.SHOPIFY_LIVE_PUBLISH_ENABLED='false';
 globalThis.fetch=async(url,opts={})=>{
  if(String(url).includes('developers.cjdropshipping.com/api2.0/v1/product/query'))return {ok:true,status:200,json:async()=>({result:true,data:{pid:'cj-test',variants:[{vid:'cj-variant'}]}})};
  const req=JSON.parse(opts.body);queries.push(req);
  if(req.query.includes('ExistingDraftsBySku'))return {ok:true,json:async()=>({data:{products:{nodes:[{id:'gid://shopify/Product/1',status:'DRAFT',vendor:'AI BUYER',variants:{nodes:[{sku:'cj-variant'}],pageInfo:{hasNextPage:false}}}],pageInfo:{hasNextPage:false}}}})};
  if(req.query.includes('RefreshDraft'))return {ok:true,json:async()=>({data:{productUpdate:{product:{id:'gid://shopify/Product/1',title:'Updated',handle:'updated',status:'DRAFT',variants:{nodes:[{id:'gid://shopify/ProductVariant/2'}]}},userErrors:[]}}})};
  if(req.query.includes('UpdateVariant'))return {ok:true,json:async()=>({data:{productVariantsBulkUpdate:{productVariants:[{id:'gid://shopify/ProductVariant/2',price:'1200'}],userErrors:[]}}})};
  throw Error('Unexpected Shopify request');
 };
 const res={code:200,setHeader(){return this},status(n){this.code=n;return this},json(v){this.body=v;return this}};
 try{
  await publish({method:'POST',headers:{cookie:'shopify_access_token=token; shopify_connected_shop=test.myshopify.com'},body:{title:'Updated',price:1200,cjProductId:'cj-test'}},res);
  assert.equal(res.code,200);assert.equal(res.body.status,'DRAFT');
  assert.equal(res.body.productId,'gid://shopify/Product/1');
  assert.ok(queries.some(x=>x.query.includes('RefreshDraft')));
  assert.ok(queries.every(x=>!x.query.includes('CreateProduct')));
 }finally{
  globalThis.fetch=previousFetch;
  for(const [key,value] of [['SHOPIFY_ALLOWED_SHOP_DOMAIN',oldShop],['CJ_ACCESS_TOKEN',oldCj],['SHOPIFY_LIVE_PUBLISH_ENABLED',oldLive]]){if(value===undefined)delete process.env[key];else process.env[key]=value}
 }
});

test('truncated Shopify draft search stops before product creation',async()=>{
 const oldShop=process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN,oldCj=process.env.CJ_ACCESS_TOKEN;
 const previousFetch=globalThis.fetch,queries=[];
 process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN='test.myshopify.com';
 process.env.CJ_ACCESS_TOKEN='test-cj';
 globalThis.fetch=async(url,opts={})=>{
  if(String(url).includes('developers.cjdropshipping.com/api2.0/v1/product/query'))return {ok:true,status:200,json:async()=>({result:true,data:{pid:'cj-test',variants:[{vid:'cj-variant'}]}})};
  const request=JSON.parse(opts.body);queries.push(request.query);
  assert.match(request.query,/ExistingDraftsBySku/);
  return {ok:true,json:async()=>({data:{products:{nodes:[],pageInfo:{hasNextPage:true}}}})};
 };
 const res={code:200,setHeader(){return this},status(n){this.code=n;return this},json(v){this.body=v;return this}};
 try{
  await publish({method:'POST',headers:{cookie:'shopify_access_token=token; shopify_connected_shop=test.myshopify.com'},body:{title:'Sample',price:1200,cjProductId:'cj-test'}},res);
  assert.equal(res.code,409);assert.match(res.body.error,/検索結果/);
  assert.equal(queries.length,1);
 }finally{
  globalThis.fetch=previousFetch;
  for(const [key,value] of [['SHOPIFY_ALLOWED_SHOP_DOMAIN',oldShop],['CJ_ACCESS_TOKEN',oldCj]]){if(value===undefined)delete process.env[key];else process.env[key]=value}
 }
});

test('growth page optimization refuses an active Shopify product before mutation',async()=>{
 const previousFetch=globalThis.fetch,oldShop=process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN;
 process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN='test.myshopify.com';
 const queries=[];
 globalThis.fetch=async(_url,opts)=>{
  const payload=JSON.parse(opts.body);queries.push(payload.query);
  assert.match(payload.query,/GrowthPageDraftCheck/);
  return {ok:true,json:async()=>({data:{product:{id:'gid://shopify/Product/12',status:'ACTIVE'}}})};
 };
 const res={code:200,setHeader(){return this},status(n){this.code=n;return this},json(v){this.body=v;return this}};
 try{
  await publish({method:'POST',headers:{cookie:'shopify_access_token=token; shopify_connected_shop=test.myshopify.com'},body:{growthPageOptimize:true,productId:'gid://shopify/Product/12',descriptionHtml:'Test product description'}},res);
  assert.equal(res.code,409);
  assert.match(res.body.error,/公開中/);
  assert.equal(queries.length,1);
 }finally{
  globalThis.fetch=previousFetch;
  if(oldShop===undefined)delete process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN;else process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN=oldShop;
 }
});

test('growth page optimization updates a verified draft without publishing',async()=>{
 const previousFetch=globalThis.fetch,oldShop=process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN;
 process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN='test.myshopify.com';
 const requests=[];
 globalThis.fetch=async(_url,opts)=>{
  const payload=JSON.parse(opts.body);requests.push(payload);
  if(payload.query.includes('GrowthPageDraftCheck'))return {ok:true,json:async()=>({data:{product:{id:'gid://shopify/Product/12',status:'DRAFT'}}})};
  if(payload.query.includes('GrowthPageOptimize'))return {ok:true,json:async()=>({data:{productUpdate:{product:{id:'gid://shopify/Product/12',title:'Sample',handle:'sample',status:'DRAFT'},userErrors:[]}}})};
  throw Error('Unexpected Shopify request');
 };
 const res={code:200,setHeader(){return this},status(n){this.code=n;return this},json(v){this.body=v;return this}};
 try{
  await publish({method:'POST',headers:{cookie:'shopify_access_token=token; shopify_connected_shop=test.myshopify.com'},body:{growthPageOptimize:true,productId:'gid://shopify/Product/12',descriptionHtml:'Japanese description'}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.growthPageOptimized,true);
  assert.equal(res.body.product.status,'DRAFT');
  assert.equal(requests.length,2);
  assert.equal(requests[1].variables.product.id,'gid://shopify/Product/12');
  assert.equal(requests[1].variables.product.descriptionHtml,'Japanese description');
  assert.ok(requests.every(x=>!x.query.includes('publishablePublish')));
 }finally{
  globalThis.fetch=previousFetch;
  if(oldShop===undefined)delete process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN;else process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN=oldShop;
 }
});

test('incomplete Shopify duplicate-search pagination fails closed before creating a product',async()=>{
 const oldShop=process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN,oldCj=process.env.CJ_ACCESS_TOKEN;
 const previousFetch=globalThis.fetch,queries=[];
 process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN='test.myshopify.com';
 process.env.CJ_ACCESS_TOKEN='test-cj';
 globalThis.fetch=async(url,opts={})=>{
  if(String(url).includes('developers.cjdropshipping.com/api2.0/v1/product/query'))return {ok:true,status:200,json:async()=>({result:true,data:{pid:'cj-test',variants:[{vid:'cj-variant'}]}})};
  const payload=JSON.parse(opts.body);queries.push(payload.query);
  assert.match(payload.query,/ExistingDraftsBySku/);
  return {ok:true,json:async()=>({data:{products:{nodes:[],pageInfo:{hasNextPage:true}}}})};
 };
 const res={code:200,setHeader(){return this},status(n){this.code=n;return this},json(v){this.body=v;return this}};
 try{
  await publish({method:'POST',headers:{cookie:'shopify_access_token=token; shopify_connected_shop=test.myshopify.com'},body:{title:'Sample',price:1200,cjProductId:'cj-test'}},res);
  assert.equal(res.code,409);
  assert.equal(queries.length,1);
  assert.ok(queries.every(q=>!q.includes('CreateProduct')));
 }finally{
  globalThis.fetch=previousFetch;
  for(const [key,value] of [['SHOPIFY_ALLOWED_SHOP_DOMAIN',oldShop],['CJ_ACCESS_TOKEN',oldCj]]){if(value===undefined)delete process.env[key];else process.env[key]=value}
 }
});
