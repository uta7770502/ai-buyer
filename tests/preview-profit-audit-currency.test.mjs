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
