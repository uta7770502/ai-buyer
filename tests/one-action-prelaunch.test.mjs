import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import oneAction from '../lib/routes/prelaunch-one-action.js';

function response(){
  return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(v){this.body=v;return this},send(v){this.body=v;return this},end(){return this}};
}
const legal={
  ODDLY_SELLER_NAME:'Seller',ODDLY_REPRESENTATIVE_NAME:'Rep',ODDLY_SELLER_ADDRESS:'Tokyo',
  ODDLY_SUPPORT_PHONE:'03-0000-0000',ODDLY_SUPPORT_EMAIL:'support@example.com',
  ODDLY_PAYMENT_TIMING:'注文時',ODDLY_SHIPPING_WINDOW:'7日以内',ODDLY_RETURN_DAYS:'7',
  ODDLY_RETURN_CONDITIONS:'未使用品',ODDLY_RETURN_SHIPPING:'お客様都合はお客様負担',
  ODDLY_ADDITIONAL_FEES:'送料は商品ページに表示',ODDLY_PRIVACY_CONTACT:'privacy@example.com'
};
function env(){
  return {
    AI_BUYER_ADMIN_KEY:'admin',
    SHOPIFY_CLIENT_ID:'id',SHOPIFY_CLIENT_SECRET:'secret',SHOPIFY_SHOP:'test',
    SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',SHOPIFY_ADMIN_ACCESS_TOKEN:'token',
    SHOPIFY_STOREFRONT_ACCESS_TOKEN:'storefront',SHOPIFY_WEBHOOK_BASE_URL:'https://example.com',
    CJ_ACCESS_TOKEN:'cj',UPSTASH_REDIS_REST_URL:'https://redis.example',UPSTASH_REDIS_REST_TOKEN:'redis',
    CJ_SANDBOX_ORDER_ENABLED:'true',SHOPIFY_FULFILLMENT_SYNC_ENABLED:'true',
    CJ_MAX_ITEMS_PER_ORDER:'10',CJ_MAX_ORDER_VALUE:'100',CJ_MAX_FREIGHT_USD:'20',CJ_ORDER_LIMIT_CURRENCY:'USD',
    SHOPIFY_LIVE_PUBLISH_ENABLED:'false',CJ_ALLOW_REAL_SHOPIFY_ORDERS_IN_SANDBOX:'false',
    ADS_LIVE_ENABLED:'false',ODDLY_CHECKOUT_ENABLED:'false',ODDLY_SEARCH_INDEX_ENABLED:'false',...legal
  };
}
function restore(previous){
  for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];
  Object.assign(process.env,previous);
}

test('one-action prelaunch refuses to run when a public launch switch is on',async t=>{
  const previous={...process.env};Object.assign(process.env,env(),{ODDLY_CHECKOUT_ENABLED:'true'});t.after(()=>restore(previous));
  t.mock.method(globalThis,'fetch',async()=>{throw Error('network must not be called')});
  const res=response();
  await oneAction({method:'POST',headers:{authorization:'Bearer admin'},body:{},query:{}},res);
  assert.equal(res.code,409);
  assert.match(res.body.error,/公開系スイッチ/);
});

test('one-action prelaunch reaches final manual step using read-only verified checks',async t=>{
  const previous={...process.env};Object.assign(process.env,env());t.after(()=>restore(previous));
  t.mock.method(globalThis,'fetch',async(url,opts={})=>{
    const s=String(url);
    if(s==='https://redis.example/ping')return {ok:true,json:async()=>({result:'PONG'})};
    if(s==='https://redis.example/'){
      const cmd=JSON.parse(opts.body||'[]');
      if(cmd[0]==='SCAN')return {ok:true,json:async()=>({result:['0',[]]})};
      if(cmd[0]==='MGET')return {ok:true,json:async()=>({result:cmd.slice(1).map(()=>null)})};
      throw Error('unexpected redis command');
    }
    if(s.includes('developers.cjdropshipping.com')&&s.includes('getCategory'))return {ok:true,json:async()=>({result:true,data:[]})};
    if(s.includes('/api/2026-10/graphql.json')){
      const body=JSON.parse(opts.body||'{}'),q=String(body.query||'');
      if(q.includes('PrelaunchProductAudit'))return {ok:true,json:async()=>({data:{products:{nodes:[{
        id:'gid://shopify/Product/1',title:'テスト商品',description:'日本語の商品説明',handle:'test',status:'DRAFT',vendor:'ODDLY',tags:[],
        variants:{nodes:[{id:'gid://shopify/ProductVariant/1',sku:'CJ-V1',price:'2980'}],pageInfo:{hasNextPage:false}},
        media:{nodes:[{image:{url:'https://example.com/a.jpg'}}],pageInfo:{hasNextPage:false}},
        metafields:{nodes:[
          {key:'adps_audience',value:'一般消費者'},{key:'adps_summary',value:'商品要約'},{key:'adps_why',value:'選定理由'},
          {key:'shipping_price_jpy',value:'500'},{key:'shipping_country',value:'JP'},{key:'return_days',value:'7'}
        ],pageInfo:{hasNextPage:false}}
      }],pageInfo:{hasNextPage:false,endCursor:null}}}})};
      if(q.includes('ReadinessShop'))return {ok:true,json:async()=>({data:{shop:{id:'gid://shopify/Shop/1',name:'ODDLY'}}})};
      if(q.includes('ReadinessScopes'))return {ok:true,json:async()=>({data:{currentAppInstallation:{accessScopes:[{handle:'write_merchant_managed_fulfillment_orders'}]}}})};
      if(q.includes('ReadinessWebhooks'))return {ok:true,json:async()=>({data:{webhookSubscriptions:{nodes:[{topic:'ORDERS_PAID',uri:'https://example.com/api/shopify-order-webhook'}],pageInfo:{hasNextPage:false}}}})};
      if(q.includes('ReadinessStorefront'))return {ok:true,json:async()=>({data:{shop:{name:'ODDLY'}}})};
    }
    throw Error('unexpected fetch '+s);
  });
  const res=response();
  await oneAction({method:'POST',headers:{authorization:'Bearer admin'},body:{},query:{}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.readyToFinalManualStep,true);
  assert.equal(res.body.changedPublicationState,false);
  assert.equal(res.body.changedCheckoutState,false);
  assert.equal(res.body.createdLiveOrder,false);
  assert.equal(res.body.changedAdsState,false);
  assert.equal(res.body.removedStorefrontPassword,false);
  assert.deepEqual(res.body.blockers,[]);
});

test('admin UI exposes one-click prelaunch button without a public-launch action',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/ワンアクションで公開直前まで/);
  assert.match(html,/safetyContract!=='prelaunch-read-only-v1'/);
  const start=html.indexOf('async function runOneActionPrelaunch');
  const end=html.indexOf('async function checkReleaseReadiness',start);
  const block=html.slice(start,end);
  assert.doesNotMatch(block,/SHOPIFY_LIVE_PUBLISH_ENABLED/);
  assert.doesNotMatch(block,/ODDLY_CHECKOUT_ENABLED\s*=\s*true/);
  assert.doesNotMatch(block,/fetch\([^\n]*password|removeStorefrontPassword|disablePasswordProtection/i);
});

test('one-action UI auto-repairs known draft metadata and respects CJ QPS pacing',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/async function repairPrelaunchDraftMetadata/);
  assert.match(html,/shippingCountry:'JP'/);
  assert.match(html,/shippingPriceJpy=shipping/);
  assert.match(html,/const productIssues=/);
  assert.match(html,/productIssues\.map\([\s\S]*?reasons/);
  assert.match(html,/await waitMs\(1150\)/);
});

test('prelaunch auto repair localizes draft titles but never active products',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const api=fs.readFileSync(new URL('../api/shopify-publish.js',import.meta.url),'utf8');
  assert.match(html,/prelaunchDraftRepair:true/);
  assert.match(html,/const source=local\|\|\{name:row\.title\|\|''\}/);
  assert.match(html,/titleJa:japaneseProductName\(source\)/);
  assert.match(api,/if\(product\.status!=='DRAFT'\)return res\.status\(409\)/);
  assert.match(api,/changedPublicationState:false/);
});

test('prelaunch repair also fixes orphan Shopify drafts without local candidate state',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/\|\|null;/);
  assert.match(html,/const source=local\|\|\{name:row\.title\|\|''\}/);
  assert.match(html,/kitchen knife sharpener\|knife sharpener/);
  assert.match(html,/shippingCountry:'JP'/);
});

test('orphan Shopify drafts receive conservative AIO metadata without inventing specs',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/function conservativePrelaunchAio/);
  assert.match(html,/家庭で包丁のメンテナンスをしたい方/);
  assert.match(html,/詳細仕様は商品ページの確認情報を優先します/);
  assert.match(html,/adpsAudience:local\?\.adpsAudience\|\|local\?\.audience\|\|fallbackAio\.audience/);
  assert.match(html,/adpsWhy:local\?\.adpsWhy\|\|local\?\.why\|\|fallbackAio\.why/);
});

test('readiness UI accepts current read-only verification contract',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/verification==='read-only-connectivity'/);
  assert.doesNotMatch(html,/verification==='configuration-only'/);
});
