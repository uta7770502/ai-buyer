import test from 'node:test';
import assert from 'node:assert/strict';
import checkout from '../lib/routes/storefront-checkout.js';
import config from '../lib/routes/storefront-config.js';

function res(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(v){this.body=v;return this}}}

test('checkout stays disabled before final launch without network calls',async t=>{
  const prev={...process.env};
  process.env.ODDLY_CHECKOUT_ENABLED='false';
  t.after(()=>{for(const k of Object.keys(process.env))if(!(k in prev))delete process.env[k];Object.assign(process.env,prev)});
  t.mock.method(globalThis,'fetch',async()=>{throw Error('network must not be called')});
  const r=res();
  await checkout({method:'POST',body:{lines:[{merchandiseId:'gid://shopify/ProductVariant/1',quantity:1}]}},r);
  assert.equal(r.code,503);
  assert.equal(r.body.checkoutEnabled,false);
});

test('enabled checkout creates a Shopify cart only for valid variant ids',async t=>{
  const prev={...process.env};
  Object.assign(process.env,{ODDLY_CHECKOUT_ENABLED:'true',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',SHOPIFY_STOREFRONT_ACCESS_TOKEN:'token'});
  t.after(()=>{for(const k of Object.keys(process.env))if(!(k in prev))delete process.env[k];Object.assign(process.env,prev)});
  let body;
  t.mock.method(globalThis,'fetch',async(url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({data:{cartCreate:{cart:{id:'gid://shopify/Cart/1',checkoutUrl:'https://test.myshopify.com/checkouts/test',totalQuantity:2},userErrors:[]}}})}});
  const r=res();
  await checkout({method:'POST',body:{lines:[{merchandiseId:'gid://shopify/ProductVariant/123',quantity:2}]}},r);
  assert.equal(r.code,200);assert.equal(r.body.ok,true);assert.equal(body.variables.input.lines[0].quantity,2);
});

test('legal config stays not ready until every required public field exists',async t=>{
  const prev={...process.env};
  for(const k of Object.keys(process.env))if(k.startsWith('ODDLY_'))delete process.env[k];
  t.after(()=>{for(const k of Object.keys(process.env))if(!(k in prev))delete process.env[k];Object.assign(process.env,prev)});
  Object.assign(process.env,{VERCEL_ENV:'production',UPSTASH_REDIS_REST_URL:'https://redis.example',UPSTASH_REDIS_REST_TOKEN:'test'});
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({result:null})}));
  let r=res();await config({method:'GET'},r);assert.equal(r.body.legalReady,false);
  Object.assign(process.env,{
    ODDLY_SELLER_NAME:'Seller',ODDLY_REPRESENTATIVE_NAME:'Representative',ODDLY_SELLER_ADDRESS:'Tokyo',
    ODDLY_SUPPORT_PHONE:'03-0000-0000',ODDLY_SUPPORT_EMAIL:'support@example.com',
    ODDLY_PAYMENT_TIMING:'注文時',ODDLY_SHIPPING_WINDOW:'注文後7日以内',
    ODDLY_RETURN_DAYS:'7',ODDLY_RETURN_CONDITIONS:'未使用品に限る',ODDLY_RETURN_SHIPPING:'お客様都合はお客様負担',
    ODDLY_ADDITIONAL_FEES:'送料は商品ページに表示',ODDLY_PRIVACY_CONTACT:'privacy@example.com'
  });
  r=res();await config({method:'GET'},r);assert.equal(r.body.legalReady,true);
});
