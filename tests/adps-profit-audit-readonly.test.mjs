import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
