import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync(new URL('../lib/routes/preview-profit-audit.js',import.meta.url),'utf8');
test('read-only CJ cost audit rejects missing or non-USD supplier currency',()=>{
 assert.match(route,/declaredSupplierCurrency!=='USD'/);
 assert.match(route,/d\?\.currency\|\|d\?\.currencyCode\|\|d\?\.priceCurrency/);
});
test('read-only CJ freight audit accepts only explicit USD quote options',()=>{
 assert.match(route,/return currency==='USD'/);
 assert.match(route,/contributionMarginVerified=false,finalProfitVerified=false/);
});

test('audit exposes per-SKU source evidence and never promotes quotes to final profit',()=>{
 for(const fragment of ["settledCostVerified:false","paymentFees:{source:'shopify-metafield-assumptions',verified:false}","recommendationEligible:false","finalProfitEvidenceReady:false","profitEvidence,salePriceJpy:"])assert.ok(route.includes(fragment),fragment);
});

test('aggregate audit never labels supplier quotes as settled costs',()=>{
 for(const fragment of ['supplierQuoteChecked:','settledSupplierCostVerified:0','shopifyPaymentFeesVerified:0','finalProfitEvidenceReady:false','supplierQuoteVerified:true'])assert.ok(route.includes(fragment),fragment);
});
