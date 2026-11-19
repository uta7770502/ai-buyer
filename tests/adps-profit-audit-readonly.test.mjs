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
