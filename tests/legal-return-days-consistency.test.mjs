import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('legal and product return day checks enforce the same upper bound',()=>{
 const legal=readFileSync(new URL('../lib/routes/release-readiness.js',import.meta.url),'utf8');
 const audit=readFileSync(new URL('../lib/routes/prelaunch-product-audit.js',import.meta.url),'utf8');
 assert.match(legal,/legalReturnDays:[^\n]*Number\.isSafeInteger\(Number\(days\)\)&&Number\(days\)<=365/);
 assert.match(audit,/Number\.isSafeInteger\(Number\(byKey\.return_days\)\)\|\|Number\(byKey\.return_days\)>365/);
});


test('return audit produces review requirements without authorizing refunds or supplier returns',async()=>{
 const {summarizeReturns}=await import('../lib/routes/shopify-return-audit.js');
 const rows=summarizeReturns({pageInfo:{hasNextPage:false},nodes:['REQUESTED','OPEN','CLOSED'].map((status,i)=>({id:'gid://shopify/Return/'+(i+1),status,totalQuantity:1}))});
 assert.equal(rows.length,3);
 assert.deepEqual(rows.map(r=>r.reviewRequired),[true,true,false]);
 assert.ok(rows[0].requiredEvidence.includes('supplier_return_eligibility'));
 assert.ok(rows[1].requiredEvidence.includes('verified_return_destination'));
 assert.ok(rows.every(r=>!r.automaticRefundAllowed&&!r.automaticReturnAllowed));
 assert.equal(summarizeReturns({pageInfo:{hasNextPage:true},nodes:[]}),null);
});
