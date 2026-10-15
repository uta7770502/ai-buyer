import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import productPage from '../api/oddly-product.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('AI growth suggestions do not silently select or create Shopify drafts',()=>{
  const start=html.indexOf("if(goal.phase==='chase'){");
  const end=html.indexOf("for(const x of pool){",start);
  assert.ok(start>=0&&end>start);
  const section=html.slice(start,end);
  assert.match(section,/tag:'選択待ち'/);
  assert.doesNotMatch(section,/active\.push\(/);
  assert.doesNotMatch(section,/autoPrepareSelectedProduct\(/);
  assert.match(html,/async function autoPrepareSelectedProduct\(x,attempt=0\)\{\s*if\(x\?\.uiSelected===false\)return/);
  assert.match(html,/qty:0,\s*status:'candidate'/);
});

test('ODDLY never fabricates free shipping or returns when metafields are absent',async t=>{
  const previous={SHOPIFY_ALLOWED_SHOP_DOMAIN:process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN,SHOPIFY_STOREFRONT_ACCESS_TOKEN:process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN,ODDLY_SEARCH_INDEX_ENABLED:process.env.ODDLY_SEARCH_INDEX_ENABLED};
  process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN='test.myshopify.com';
  process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN='test-storefront';
  process.env.ODDLY_SEARCH_INDEX_ENABLED='false';
  t.after(()=>{for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({data:{product:{
    title:'Example',description:'Test product',productType:'Goods',vendor:'Maker',
    featuredImage:null,adpsSummary:null,audience:null,adpsWhy:null,
    shippingPrice:null,shippingCountry:null,returnDays:null,
    variants:{nodes:[{availableForSale:true,sku:'SKU-1',price:{amount:'1200',currencyCode:'JPY'}}]}
  }}})}));
  const headers={};
  const res={setHeader(k,v){headers[k]=v;return this},status(n){this.code=n;return this},send(v){this.body=v;return this}};
  await productPage({method:'GET',query:{handle:'example'}},res);
  assert.equal(res.code,200);
  assert.match(res.body,/送料・配送条件は確認中です/);
  assert.match(res.body,/返品条件は確認中です/);
  assert.doesNotMatch(res.body,/送料：無料/);
  assert.doesNotMatch(res.body,/shippingRate/);
  assert.doesNotMatch(res.body,/merchantReturnDays/);
  assert.equal(headers['X-Robots-Tag'],'noindex, follow');
});
