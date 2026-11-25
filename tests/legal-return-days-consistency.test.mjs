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

test('CJ dispute read separates supplier outcome from customer refund authority',async()=>{
 const {readSupplierDispute}=await import('../lib/routes/shopify-return-audit.js');
 const id='SH123456',data={id,status:'Processing',money:12.5,refundAmount:12.5,finallyDeal:1};
 const fetcher=async(url,opts)=>{assert.equal(url.searchParams.get('disputeId'),id);assert.equal(opts.method,'GET');return {ok:true,json:async()=>({code:200,result:true,data})};};
 const result=await readSupplierDispute(id,{token:'test',fetcher});assert.equal(result.ok,true);assert.equal(result.reportedSupplierRefundUSD,12.5);assert.equal(result.customerRefundAuthorized,false);assert.equal(result.shopifyOrderLinkVerified,false);assert.equal(result.supplierRefundReceivedVerified,false);
 for(const bad of [{...data,id:'SHwrong'},{...data,refundAmount:-1},{...data,finallyDeal:99}])assert.equal((await readSupplierDispute(id,{token:'test',fetcher:async()=>({ok:true,json:async()=>({code:200,result:true,data:bad})})})).ok,false);
});

test('CJ dispute amount is distinct from supplier refund and never substituted for it',async()=>{
 const {readSupplierDispute}=await import('../lib/routes/shopify-return-audit.js');
 const id='SH123456';
 for(const amount of [null,5]){
  const r=await readSupplierDispute(id,{token:'test',fetcher:async()=>({ok:true,json:async()=>({code:200,result:true,data:{id,status:'Processing',money:12.5,refundAmount:amount}})})});
  assert.equal(r.ok,true);assert.equal(r.reportedSupplierRefundUSD,amount);assert.equal(r.requestedDisputeUSD,12.5);assert.equal(r.customerRefundAuthorized,false);
 }
});

test('supplier dispute must match linked CJ sandbox order references',async()=>{
 const {matchesLinkedDispute}=await import('../lib/routes/shopify-return-audit.js');
 const id='SH123456',linked=data=>({id:'J123456',data});
 assert.equal(matchesLinkedDispute(linked({disputeId:id,disputeOpenedId:id}),id),true);
 assert.equal(matchesLinkedDispute(linked({disputeId:id}),id),true);
 for(const d of [{},{disputeId:'SH654321'},{disputeId:id,disputeOpenedId:'SH654321'}])assert.equal(matchesLinkedDispute(linked(d),id),false);
 assert.equal(matchesLinkedDispute(null,id),false);
});
