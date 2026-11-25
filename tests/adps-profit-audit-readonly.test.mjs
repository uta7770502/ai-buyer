import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {issueStockEvidence,verifyStockEvidence} from '../lib/stock-audit-evidence.js';
const source=fs.readFileSync(new URL('../lib/routes/preview-profit-audit.js',import.meta.url),'utf8');

test('profit audit is preview-only and read-only',()=>{
 assert.match(source,/req\.method!=='GET'/);
 assert.match(source,/process\.env\.VERCEL_ENV==='preview'/);
 assert.match(source,/readOnly:true/);
});
test('audit refuses unverified store currency and merchant fee assumptions',()=>{
 assert.match(source,/currencyCode!=='JPY'/);
 assert.match(source,/shopifyPaymentFeesVerified:false/);
 assert.match(source,/recommendationEligible:false/);
 assert.match(source,/contributionMarginVerified=false,finalProfitVerified=false/);
});
test('margin exceptions do not bypass verified-profit publication gates',()=>{
 assert.match(source,/loadMarginException\(vid\)/);
 assert.match(source,/never the verified-profit or publication gates/);
});
test('CJ stock and freight are verified independently',()=>{
 assert.match(source,/product\/stock\/queryByVid/);
 assert.match(source,/logistic\/freightCalculate/);
 assert.match(source,/cjStockAvailable=stock\.total>=5/);
});

test('read-only margin audit accepts the current complete set, not a fixed nine products',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const block=html.slice(html.indexOf('async function runDraftMarginAudit(){'),html.indexOf('async function saveDraftCostScenario(){'));
 const guard=block.split('\n').find(line=>line.includes('j.catalogComplete!==true'));
 assert.ok(guard);
 const check=Function('r','j',guard+';return true;');
 for(const count of [8,9,10]){
   const rows=Array.from({length:count},(_,i)=>({sku:String(1000000000+i)}));
   const result={ok:true,readOnly:true,catalogComplete:true,targetCount:count,total:count,rows};
   assert.equal(check({ok:true},result),true);
   assert.throws(()=>check({ok:true},{...result,rows:rows.slice(1)}));
   assert.throws(()=>check({ok:true},{...result,catalogComplete:false}));
   assert.throws(()=>check({ok:true},{...result,rows:[...rows.slice(1),rows[1]]}));
 }
 assert.match(source,/catalogComplete:!requestedSku&&rows.length===products.length,targetCount:products.length/);
 assert.match(source,/data.products.pageInfo\?\.hasNextPage!==false/);
});

test('factory hold still displays independent margin tier and target prices without writing',async()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const block=html.slice(html.indexOf('async function runDraftMarginAudit(){'),html.indexOf('async function saveDraftCostScenario(){'));
 const out={textContent:''};
 const row={sku:'1234567890123456',title:'Fixture',ok:true,estimatedAuditStatus:'hold',estimatedMarginTier:20,assumptionsReady:true,salePriceJpy:2000,requiredSalePriceByMargin:{25:2200,20:1980},finalMarginPercent:20.8,requiresFactoryReplenishment:true};
 const run=Function('document','getTestAdminKey','fetch','yen','let currentStockEvidence=null;'+block+';return runDraftMarginAudit;')({getElementById:()=>out},()=> 'fixture',async(url,options)=>{assert.equal(options.method,undefined);return {ok:true,json:async()=>({ok:true,readOnly:true,catalogComplete:true,targetCount:1,total:1,rows:[row]})}},n=>'¥'+n);
 await run();
 assert.match(out.textContent,/20%以上25%未満/);
 assert.match(out.textContent,/25%に必要な価格 ¥2200/);
 assert.match(out.textContent,/20%に必要な価格 ¥1980/);
 assert.match(out.textContent,/補充日数未確認/);
 assert.match(out.textContent,/公開・価格・候補状態は変更しません/);
});

test('server-issued evidence is bound to the current complete SKU set, branch, shop and time',()=>{
 const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'safety-gate-20261024',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',SHOPIFY_TOKEN_ENCRYPTION_KEY:'ab'.repeat(32)};
 const now=1700000000000;
 const skus=['1234567890123456','1234567890123457'];
 const rows=skus.map(sku=>({sku,ok:true,cjStockVerified:true,cjStockQuantity:0,factoryStockQuantity:5}));
 const receipt=issueStockEvidence(rows,{env,now});
 assert.ok(receipt);
 assert.equal(verifyStockEvidence(receipt,[...skus].reverse(),{env,now}),true);
 assert.equal(verifyStockEvidence(receipt,skus.slice(1),{env,now}),false);
 assert.equal(verifyStockEvidence(receipt,skus,{env,now:now+900001}),false);
 assert.equal(verifyStockEvidence(receipt,skus,{env:{...env,SHOPIFY_ALLOWED_SHOP_DOMAIN:'other.myshopify.com'},now}),false);
 assert.equal(verifyStockEvidence(receipt,skus,{env:{...env,VERCEL_ENV:'production'},now}),false);
 assert.equal(verifyStockEvidence(receipt.slice(0,-1)+(receipt.endsWith('a')?'b':'a'),skus,{env,now}),false);
 assert.equal(issueStockEvidence([{...rows[0],cjStockVerified:false}],{env,now}),null);
 assert.equal(issueStockEvidence([rows[0],rows[0]],{env,now}),null);
 const route=fs.readFileSync(new URL('../lib/routes/prelaunch-one-action.js',import.meta.url),'utf8');
 assert.match(route,/verifyStockEvidence\(req.body\?\.stockEvidence,currentDrafts.map\(p=>p.sku\)\)/);
 assert.match(route,/variantLevelInventoryVerified&&item==='CJの販売バリエーション別実在庫dry-run'/);
 assert.doesNotMatch(route,/item==='CJ在庫→Shopify在庫同期のPreview実行'/);
});

test('batch audit loads the authenticated current draft catalog and uses saved cost assumptions',()=>{
 const html=fs.readFileSync(new URL('../preview-profit-batch.html',import.meta.url),'utf8');
 assert.match(source,/req\.query\?\.catalogOnly==='1'/);
 assert.match(source,/new Set\(rows\.map\(r=>r\.sku\)\)\.size!==products\.length/);
 assert.ok(source.indexOf('crypto.timingSafeEqual')<source.indexOf("req.query?.catalogOnly==='1'"));
 assert.match(html,/catalogOnly=1/);
 assert.match(html,/vids=j\.rows\.map\(x=>x\.sku\)/);
 assert.match(html,/Authorization:'Bearer '\+key/);
 assert.doesNotMatch(html,/const vids=\[/);
 assert.doesNotMatch(html,/scenario:'1'|adCostJpy:'0'|returnReserveJpy:'0'/);
 assert.match(html,/利益率15%未満：候補除外/);
});

test('price guidance retains current price or proposes a review at 25 percent unless the exact lower tier is approved',async()=>{
 const a=source.indexOf('export function makeDraftPriceGuidance('),b=source.indexOf('export default async function handler',a);
 const make=Function(source.slice(a,b).replace('export function','function')+';return makeDraftPriceGuidance')();
 const input={salePriceJpy:2000,shippingJpy:600,paymentFeeJpy:71,adCostJpy:200,returnReserveJpy:100,targetPrices:{25:2300,20:2100,15:1950},estimatedMarginTier:15};
 const p=make(input);assert.equal(p.proposedPriceJpy,2300);assert.equal(p.maximumSupplierCostByMargin[25],529);assert.equal(p.maximumSupplierCostByMargin[15],729);assert.equal(p.priceChangeAuthorized,false);assert.equal(p.publicationApproved,false);
 assert.equal(make({...input,approvedExceptionTier:20}).preferredTier,25);
 assert.equal(make({...input,approvedExceptionTier:15}).proposedPriceJpy,2000);
 assert.equal(make({...input,shippingJpy:null}),null);
});

test('batch page accepts a masked administrator key directly, verifies it before session storage and handles rejection',()=>{
 const html=fs.readFileSync(new URL('../preview-profit-batch.html',import.meta.url),'utf8');
 assert.match(html,/id="batchAdminKey" type="password"/);
 assert.match(html,/const key=keyInput\.value\.trim\(\)/);
 assert.match(html,/r\.status===401\|\|r\.status===403/);
 assert.match(html,/sessionStorage\.removeItem\('aiBuyerAdminKey'\)/);
 assert.ok(html.indexOf('vids=j.rows.map(x=>x.sku)')<html.indexOf("sessionStorage.setItem('aiBuyerAdminKey',key)"));
 assert.doesNotMatch(html,/localStorage\./);
 assert.match(html,/setBusy\(false\)/);
});
