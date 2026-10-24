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
    CJ_SANDBOX_ORDER_ENABLED:'true',SHOPIFY_FULFILLMENT_SYNC_ENABLED:'true',CJ_SHOPIFY_STOCK_SYNC_ENABLED:'true',
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

test('stock sync may remain disabled without blocking read-only prelaunch checks',async t=>{
  const previous={...process.env};Object.assign(process.env,env(),{CJ_SHOPIFY_STOCK_SYNC_ENABLED:'false'});t.after(()=>restore(previous));
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
      const q=String(JSON.parse(opts.body||'{}').query||'');
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
  assert.equal(res.body.warnings.length,0);
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

test('orphan draft repair creates safe Japanese copy and clears review tag only after verification',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const api=fs.readFileSync(new URL('../api/shopify-publish.js',import.meta.url),'utf8');
  assert.match(html,/詳細仕様・サイズ・素材・配送条件は商品ページの確認情報を優先してください/);
  assert.match(api,/product\(id:\$id\)\{id title description status vendor tags\}/);
  assert.match(api,/filter\(x=>String\(x\|\|''\)!=='要日本語確認'\)/);
  assert.match(api,/finalTitle/);
  assert.match(api,/finalDescription/);
  assert.match(api,/changedPublicationState:false/);
});

test('final launch checklist stays locked until explicit approval',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/承認商品のACTIVE化/);
  assert.match(html,/Checkout本番ON/);
  assert.match(html,/Shopify決済の最終確認/);
  assert.match(html,/ストアパスワード解除/);
  assert.match(html,/最終承認があるまで実行しません/);
});

test('orphan draft shipping requires verified server-side recovery',()=>{
  const freight=fs.readFileSync(new URL('../lib/routes/cj-freight.js',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(freight,/product\/variant\/queryByVid/);
  assert.match(freight,/variantData\.data\?\.pid/);
  assert.doesNotMatch(html,/payload\.shippingPriceJpy=Math\.round/);
  assert.match(html,/Shipping must be verified by the server/);
});

test('final launch manifest requires explicit user approval and stays non-mutating',()=>{
  const route=fs.readFileSync(new URL('../lib/routes/prelaunch-one-action.js',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(route,/requiresExplicitUserApproval:true/);
  assert.match(route,/serverVerified:readyToFinalManualStep/);
  assert.match(route,/forbiddenUntilApproval/);
  assert.match(html,/サーバー確認済み/);
  assert.match(html,/requiresExplicitUserApproval===true/);
});

test('Shopify draft preparation requires fresh server CJ shipping',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/x\.shippingSource!=='cj-server'/);
 assert.match(html,/Date\.now\(\)-Date\.parse\(x\.shippingQuotedAt\)>15\*60\*1000/);
 assert.match(html,/publishApproved:false/);
});

test('selected CJ variant is sent to Shopify and changing it clears server freight',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/cjVariantId:String\(x\.shippingVariantChoice\|\|x\.cjVariantId\|\|''\)/);
 assert.match(html,/if\(changed&&x\.shippingSource\)\{delete x\.shippingJpy/);
});

test('automatic freight preparation binds quote to exact CJ variant',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/quotedVid!==requestedVid/);
 assert.match(html,/data\.variants\.length>1&&!requestedVid/);
 assert.match(html,/x\.shippingVariantChoice=quotedVid/);
});

test('stale freight response is rejected when CJ variant changes in flight',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/const requestedVariantAtStart=String\(x\.shippingVariantChoice\|\|x\.cjVariantId\|\|''\)\.trim\(\)/);
 assert.match(html,/!==requestedVariantAtStart\)throw new Error\('送料取得中にバリエーションが変更されました/);
});

test('manual shipping save uses server verified JPY instead of browser FX',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const section=html.slice(html.indexOf('async function quoteShipping(id){'),html.indexOf('function changeShippingDestination(',html.indexOf('async function quoteShipping(id){')));
 assert.match(section,/x\.shippingJpy=option\.jpy/);
 assert.match(section,/x\.shippingSource='cj-server'/);
 assert.match(section,/x\.shippingQuotedAt=data\.fetchedAt/);
 assert.doesNotMatch(section,/x\.shippingJpy=Math\.round\(option\.usd\*fx\)/);
});

test('manual shipping quote validation never depends on browser FX',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const section=html.slice(html.indexOf('async function quoteShipping(id){'),html.indexOf('function changeShippingDestination(',html.indexOf('async function quoteShipping(id){')));
 assert.match(section,/option\.jpy<=10000000/);
 assert.doesNotMatch(section,/option\.usd\*fx/);
});

test('shipping destination change clears stale quote and UI reflects server source',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/hasValidShipping\(x\)\|\|Boolean\(x\.shippingSource\)/);
 assert.match(html,/x\.shippingSource==='cj-server'\?'CJ見積保存済み/);
 assert.doesNotMatch(html,/中国発送・最初のバリエーションで見積/);
});

test('automatic preparation explains when CJ variant selection is required',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/response\.status===422&&\/バリエーション\|色・サイズ\/\.test/);
 assert.match(html,/x\.autoSetupLastError='variant_selection_required'/);
 assert.match(html,/送料見積からバリエーションを選択してください/);
});

test('selecting required CJ variant resumes automatic draft preparation',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/changed&&x\.autoSetupState==='needs_review'&&x\.autoSetupLastError==='variant_selection_required'/);
 assert.match(html,/x\.autoSetupAttempts=0/);
 assert.match(html,/autoPrepareSelectedProduct\(x\)\.catch/);
});

test('CJ multivariant freight returns choices before quoting and frontend offers picker',()=>{
 const server=fs.readFileSync(new URL('../lib/routes/cj-freight.js',import.meta.url),'utf8');
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(server,/code:'VARIANT_SELECTION_REQUIRED'/);
 assert.match(server,/variants:validVariants\.map/);
 assert.match(html,/response\.status===422&&data\.code==='VARIANT_SELECTION_REQUIRED'/);
 assert.match(html,/button\.textContent='このバリエーションで送料を見積'/);
 assert.match(html,/x\.shippingVariantChoice=vid/);
});

test('changing variant invalidates previously ready auto preparation',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/changed&&x\.autoSetupState==='ready'/);
 assert.match(html,/x\.autoSetupLastError='variant_changed'/);
 assert.match(html,/送料とShopify下書きの再確認が必要です/);
});

test('registered Shopify products cannot silently change CJ variant in either picker',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/if\(x\.shopifyProductId\)\{showCandidateToast\('Shopify登録済みの商品はバリエーションを変更できません/);
 assert.match(html,/if\(x\.shopifyProductId\)\{showCandidateToast\('Shopify登録済み商品のバリエーション変更はできません/);
});

test('automatic Shopify draft submission skips already registered products',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/async function autoPublishCandidate\(x\).*?x\.shopifyProductId\|\|x\.shopifyPublishState==='publishing'/s);
});

test('Shopify response after deselection records reconciliation notice',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/if\(findActive\(x\.id\)!==x\)\{addOps\('Shopify下書き作成結果'/);
 assert.match(html,/選択解除後にShopifyから応答/);
});

test('market monitor holds sales when CJ variant stock is not verified',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/current\.variantInventoryVerified!==true/);
 assert.match(html,/kind:'バリエーション在庫未確認'/);
 assert.match(html,/販売判定を保留します/);
});

test('CJ monitor failure holds candidate and clears last verified monitoring timestamp',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/x\.monitorRisk='unknown';x\.monitorStopCandidate=true;x\.stopCandidate=true;x\.status='candidate';x\.lastMonitorAt=''/);
 assert.match(html,/level:'critical',kind:'取得失敗'/);
});

test('batch CJ monitoring failure invalidates all cached safety states',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/for\(const x of active\)\{x\.monitorRisk='unknown';x\.monitorStopCandidate=true;x\.stopCandidate=true;x\.status='candidate';x\.lastMonitorAt='';\}/);
 assert.match(html,/kind:'監視全体の取得失敗'/);
});

test('CJ monitor reconciles only requested product IDs',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/const requestedIds=new Set\(ids\)/);
 assert.match(html,/const validResults=all\.filter\(p=>p&&requestedIds\.has\(String\(p\.id\)\)&&Number\.isSafeInteger\(p\.stockTotal\)/);
 assert.match(html,/for\(const current of validResults\.filter\(p=>!failed\.has\(String\(p\.id\)\)\)\)/);
});

test('duplicate CJ monitor product results are rejected as ambiguous',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/const duplicateIds=new Set\(\)/);
 assert.match(html,/for\(const id of duplicateIds\)failed\.set/);
 assert.match(html,/validResults\.filter\(p=>!failed\.has\(String\(p\.id\)\)\)/);
});

test('CJ monitor operation log excludes failed and duplicate products from success count',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/validResults\.filter\(p=>!failed\.has\(String\(p\.id\)\)\)\.length/);
 assert.match(html,/対象外応答 \$\{invalidResponseIds\}件/);
});

test('rejected CJ responses cannot remain in verified result set',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/for\(const id of failed\.keys\(\)\)returned\.delete\(id\)/);
});

test('Shopify auto-stop requires confirmed draft response before local success state',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/j\.status!=='DRAFT'/);
 assert.match(html,/Shopify販売停止の反映を確認できません/);
});

test('CJ monitor treats missing supplier sale status as critical',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/if\(!saleStatus\)alerts\.push/);
 assert.match(html,/販売状態未確認/);
});

test('prelaunch reconciliation must explicitly verify all counts and completion',()=>{
  const source=fs.readFileSync(new URL('../lib/routes/prelaunch-one-action.js',import.meta.url),'utf8');
  assert.match(source,/Number\.isSafeInteger\(reconciliation\.body\?\.summary\?\.total\)/);
  assert.match(source,/Number\.isSafeInteger\(reconciliation\.body\?\.summary\?\.critical\)/);
  assert.match(source,/Number\.isSafeInteger\(reconciliation\.body\?\.summary\?\.review\)/);
  assert.match(source,/reconciliation\.body\?\.summary\?\.partial===false/);
  assert.doesNotMatch(source,/Number\(reconciliation\.body\?\.summary\?\.total\|\|0\)===0/);
});

test('prelaunch audit blocks incomplete shipping and active products',()=>{
  const audit=fs.readFileSync(new URL('../lib/routes/prelaunch-product-audit.js',import.meta.url),'utf8');
  assert.match(audit,/nonDraftRows.length===0/);
  assert.match(audit,/byKey.shipping_country!=='JP'/);
  assert.match(audit,/Number.isFinite/);
});

test('one-action prelaunch reports non-draft product blockers explicitly',()=>{
  const source=fs.readFileSync(new URL('../lib/routes/prelaunch-one-action.js',import.meta.url),'utf8');
  assert.match(source,/audit\.body\.nonDraftCount>0/);
  assert.match(source,/管理対象の商品が下書き以外になっています/);
  assert.match(source,/nonDraftCount:Number\(audit\.body\?\.nonDraftCount\|\|0\)/);
});

test('product audit fails closed if Shopify connection data is incomplete',()=>{
  const source=fs.readFileSync(new URL('../lib/routes/prelaunch-product-audit.js',import.meta.url),'utf8');
  assert.match(source,/Shopify audit pagination unverified/);
  assert.match(source,/Array\.isArray\(p\.variants\?\.nodes\)/);
  assert.match(source,/Array\.isArray\(p\.media\?\.nodes\)/);
  assert.match(source,/Array\.isArray\(p\.metafields\?\.nodes\)/);
  assert.match(source,/監査データが不足しています/);
});


test('draft audit fails closed on GraphQL error envelopes and unapproved vendors',()=>{
 const audit=fs.readFileSync(new URL('../lib/routes/prelaunch-product-audit.js',import.meta.url),'utf8');
 assert.match(audit,/Object\.hasOwn\(j,'errors'\)/);
 assert.match(audit,/!j\.data\|\|typeof j\.data!=='object'/);
 assert.match(audit,/!\['ODDLY','AI BUYER'\]\.includes\(p\.vendor\)/);
 assert.match(audit,/管理対象外の販売元です/);
});

test('one-action runs independent diagnostics concurrently and treats rejection as failure',()=>{
 const route=fs.readFileSync(new URL('../lib/routes/prelaunch-one-action.js',import.meta.url),'utf8');
 assert.match(route,/Promise\.all\(\[/);
 assert.match(route,/\.map\(p=>p\.catch\(\(\)=>\(\{code:503,body:\{ok:false\}\}\)\)\)/);
 assert.match(route,/readiness\.code===200&&readiness\.body\?\.ok===true/);
 assert.match(route,/audit\.code===200&&audit\.body\?\.ok===true/);
});
