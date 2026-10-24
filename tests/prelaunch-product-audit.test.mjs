import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import audit from '../lib/routes/prelaunch-product-audit.js';

function res(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v;return this}}}

test('prelaunch product audit blocks incomplete ODDLY drafts',async t=>{
  const prev={...process.env};
  Object.assign(process.env,{
    AI_BUYER_ADMIN_KEY:'admin',
    SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',
    SHOPIFY_ADMIN_ACCESS_TOKEN:'token'
  });
  t.after(()=>{for(const k of Object.keys(process.env))if(!(k in prev))delete process.env[k];Object.assign(process.env,prev)});
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({data:{products:{
    nodes:[{
      id:'gid://shopify/Product/1',title:'テスト商品',description:'日本語の商品説明',handle:'test',status:'DRAFT',vendor:'ODDLY',tags:[],
      variants:{nodes:[{id:'gid://shopify/ProductVariant/1',sku:'CJ-V1',price:'2980'}],pageInfo:{hasNextPage:false}},
      media:{nodes:[{image:{url:'https://example.com/a.jpg'}}],pageInfo:{hasNextPage:false}},
      metafields:{nodes:[
        {key:'adps_audience',value:'一般消費者'},
        {key:'adps_summary',value:'商品要約'},
        {key:'adps_why',value:'選定理由'},
        {key:'shipping_price_jpy',value:'500'},
        {key:'shipping_country',value:'JP'},
        {key:'return_days',value:'7'}
      ],pageInfo:{hasNextPage:false}}
    },{
      id:'gid://shopify/Product/2',title:'English only',description:'English only',handle:'bad',status:'DRAFT',vendor:'ODDLY',tags:['要日本語確認'],
      variants:{nodes:[{id:'gid://shopify/ProductVariant/2',sku:'',price:'0'}],pageInfo:{hasNextPage:false}},
      media:{nodes:[],pageInfo:{hasNextPage:false}},
      metafields:{nodes:[],pageInfo:{hasNextPage:false}}
    }],
    pageInfo:{hasNextPage:false,endCursor:null}
  }}})}));
  const r=res();
  await audit({method:'GET',headers:{authorization:'Bearer admin'},query:{}},r);
  assert.equal(r.code,200);
  assert.equal(r.body.draftCount,2);
  assert.equal(r.body.readyDrafts,1);
  assert.equal(r.body.blockedDrafts,1);
  assert.equal(r.body.allDraftsReady,false);
  const blocked=r.body.products.find(p=>p.id==='gid://shopify/Product/2');
  assert.ok(blocked?.reasons.includes('SKU未設定'));
  assert.ok(blocked?.reasons.includes('商品画像なし'));
  assert.equal(r.body.products[0].id,'gid://shopify/Product/2');
});

test('prelaunch product audit is admin protected',async()=>{
  const r=res();
  await audit({method:'GET',headers:{},query:{}},r);
  assert.equal(r.code,401);
});

test('prelaunch audit never approves partial scans or multiple variants without individual checks',()=>{
 const source=readFileSync(new URL('../lib/routes/prelaunch-product-audit.js',import.meta.url),'utf8');
 assert.match(source,/allDraftsReady:!more&&draftRows\.length>0&&notReady\.length===0/);
 assert.match(source,/p\.variants\?\.nodes\|\|\[\]\)\.length!==1/);
});

test('prelaunch audit refuses malformed Shopify GraphQL errors',async t=>{
 const prev={...process.env};
 Object.assign(process.env,{AI_BUYER_ADMIN_KEY:'admin',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',SHOPIFY_ADMIN_ACCESS_TOKEN:'token'});
 t.after(()=>{for(const k of Object.keys(process.env))if(!(k in prev))delete process.env[k];Object.assign(process.env,prev)});
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({errors:{message:'unknown'},data:{products:{nodes:[],pageInfo:{hasNextPage:false}}}}})}));
 const r=res();
 await audit({method:'GET',headers:{authorization:'Bearer admin'},query:{}},r);
 assert.equal(r.code,503);
 assert.equal(r.body.ok,false);
});

test('prelaunch audit rejects duplicate product IDs rather than reporting readiness',async t=>{
 const prev={...process.env};
 Object.assign(process.env,{AI_BUYER_ADMIN_KEY:'admin',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',SHOPIFY_ADMIN_ACCESS_TOKEN:'token'});
 t.after(()=>{for(const k of Object.keys(process.env))if(!(k in prev))delete process.env[k];Object.assign(process.env,prev)});
 const p={id:'gid://shopify/Product/123',title:'日本語商品',description:'日本語の説明',handle:'a',status:'DRAFT',vendor:'ODDLY',tags:[],
  variants:{nodes:[{id:'gid://shopify/ProductVariant/1',sku:'123456789012',price:'2000'}],pageInfo:{hasNextPage:false}},
  media:{nodes:[{image:{url:'https://example.com/p.png'}}],pageInfo:{hasNextPage:false}},
  metafields:{nodes:[{key:'adps_audience',value:'飼い主'},{key:'adps_summary',value:'要約'},{key:'adps_why',value:'理由'},
    {key:'shipping_price_jpy',value:'500'},{key:'shipping_country',value:'JP'},{key:'return_days',value:'7'}],pageInfo:{hasNextPage:false}}};
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({data:{products:{nodes:[p,{...p}],pageInfo:{hasNextPage:false,endCursor:null}}}})}));
 const r=res();
 await audit({method:'GET',headers:{authorization:'Bearer admin'},query:{}},r);
 assert.equal(r.code,503);
 assert.match(r.body.error,/duplicate or missing product identifiers/);
});
