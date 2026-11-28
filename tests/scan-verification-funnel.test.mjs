import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function renderScanSummary()');
const end=html.indexOf('function oddlyPetRelevant(p)',start);
const summary=html.slice(start,end);
test('scan summary displays distinct review, stock and verified profit counts',()=>{
 assert.ok(start>=0&&end>start);
 for(const key of ['petEligible','reviewVerified','stockEligible','finalProfitVerified'])assert.ok(summary.includes('s.'+key),key);
});
test('empty recommendations explain that unverified products remain in review',()=>{
 assert.match(summary,/販売候補0件/);
 assert.match(summary,/審査待ちの商品を確認/);
});
