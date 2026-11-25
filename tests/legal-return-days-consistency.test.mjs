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

test('CJ documented final refund aliases agree and never authorize customer refunds',async()=>{
 const {readSupplierDispute}=await import('../lib/routes/shopify-return-audit.js');
 const id='SH123456';
 for(const amount of [null,5]){
  const r=await readSupplierDispute(id,{token:'test',fetcher:async()=>({ok:true,json:async()=>({code:200,result:true,data:{id,status:'Processing',money:12.5,refundAmount:amount}})})});
  if(amount===null){assert.equal(r.ok,true);assert.equal(r.reportedSupplierRefundUSD,12.5);assert.equal(r.requestedDisputeUSD,null);assert.equal(r.customerRefundAuthorized,false);}else assert.equal(r.ok,false);
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

test('CJ dispute draft uses confirmed prices and quantities and never authorizes submission',async()=>{
 const {buildDisputeDraft}=await import('../lib/routes/shopify-return-audit.js');
 const x={orderId:'DR123',businessDisputeId:'return-123',disputeReasonId:1,expectType:1,refundType:1,messageText:'Item damaged',items:[{lineItemId:'12345',quantity:1,price:999}],confirmedItems:[{lineItemId:'12345',quantity:2,price:9.99}],allowedReasonIds:[1]};
 const r=buildDisputeDraft(x);assert.equal(r.ok,true);assert.equal(r.payload.productInfoList[0].price,9.99);assert.equal(r.submissionAllowed,false);assert.equal(r.customerRefundAuthorized,false);
 for(const patch of [{disputeReasonId:2},{items:[{lineItemId:'12345',quantity:3}]},{items:[...x.items,...x.items]},{confirmedItems:[]},{expectType:3},{messageText:''}])assert.equal(buildDisputeDraft({...x,...patch}).ok,false);
});

test('CJ eligible products reads exact order and excludes unselectable lines',async()=>{
 const {readDisputableProducts}=await import('../lib/routes/shopify-return-audit.js');
 const orderId='J123456',a={lineItemId:'12345',quantity:2,price:9.99,canChoose:true},b={...a,lineItemId:'12346',canChoose:false};
 const read=async(data)=>readDisputableProducts(orderId,{token:'test',fetcher:async(u,o)=>{assert.equal(u.searchParams.get('orderId'),orderId);assert.equal(o.method,'GET');return {ok:true,json:async()=>({code:200,result:true,data})};}});
 const r=await read({orderId,productInfoList:[a,b]});assert.equal(r.ok,true);assert.deepEqual(r.eligibleItems,[{lineItemId:'12345',quantity:2,price:9.99}]);assert.equal(r.submissionAllowed,false);
 for(const data of [{orderId:'wrong',productInfoList:[a]},{orderId,productInfoList:[a,a]},{orderId,productInfoList:[{...a,canChoose:'true'}]},{orderId,productInfoList:[{...a,price:-1}]}])assert.equal((await read(data)).ok,false);
});

test('CJ preflight reads exact selected lines and refund limits without creating a dispute',async()=>{
 const {confirmDisputeTerms}=await import('../lib/routes/shopify-return-audit.js');
 const orderId='J123456',selected=[{lineItemId:'12345',quantity:1,price:9.99}],data={orderId,productInfoList:selected,expectResultOptionList:['1'],disputeReasonList:[{disputeReasonId:1,reasonName:'Cancellation'}],maxProductPrice:9.99,maxPostage:0,maxIossTaxAmount:0,maxIossHandTaxAmount:0,maxAmount:9.99};
 const run=async(d)=>confirmDisputeTerms(orderId,selected,{token:'test',fetcher:async(u,o)=>{assert.ok(u.endsWith('/disputeConfirmInfo'));assert.equal(o.method,'POST');assert.deepEqual(JSON.parse(o.body),{orderId,productInfoList:selected});return {ok:true,json:async()=>({code:200,result:true,data:d})};}});
 const r=await run(data);assert.equal(r.ok,true);assert.equal(r.maxRefundUSD,9.99);assert.equal(r.submissionAllowed,false);
 for(const bad of [{...data,orderId:'wrong'},{...data,maxAmount:-1},{...data,expectResultOptionList:['3']},{...data,productInfoList:[]}])assert.equal((await run(bad)).ok,false);
});

test('integrated CJ draft preflight uses supplier prices and stops before creation',async()=>{
 const {prepareDisputeDraft}=await import('../lib/routes/shopify-return-audit.js');
 const orderId='J123456',line={lineItemId:'12345',quantity:2,price:9.99,canChoose:true};
 const input={orderId,businessDisputeId:'return-123',disputeReasonId:1,expectType:1,refundType:1,messageText:'Item damaged',items:[{lineItemId:'12345',quantity:1,price:999}]};
 const calls=[];
 const fetcher=async(u,o)=>{
  calls.push(String(u));
  if(String(u).includes('/disputeProducts?'))return {ok:true,json:async()=>({code:200,result:true,data:{orderId,productInfoList:[line]}})};
  assert.ok(String(u).endsWith('/disputeConfirmInfo'));
  const selected=JSON.parse(o.body).productInfoList;
  assert.deepEqual(selected,[{lineItemId:'12345',quantity:1,price:9.99}]);
  return {ok:true,json:async()=>({code:200,result:true,data:{orderId,productInfoList:selected,expectResultOptionList:['1'],disputeReasonList:[{disputeReasonId:1,reasonName:'Damage'}],maxProductPrice:9.99,maxPostage:0,maxIossTaxAmount:0,maxIossHandTaxAmount:0,maxAmount:9.99}})};
 };
 const r=await prepareDisputeDraft(input,{token:'test',fetcher});assert.equal(r.ok,true);assert.equal(r.payload.productInfoList[0].price,9.99);assert.equal(r.submissionAllowed,false);assert.equal(r.shopifyReturnLineLinkVerified,false);assert.equal(calls.length,2);
 calls.length=0;assert.equal((await prepareDisputeDraft({...input,items:[{lineItemId:'12345',quantity:3}]},{token:'test',fetcher})).ok,false);assert.equal(calls.length,1);
 calls.length=0;assert.equal((await prepareDisputeDraft({...input,expectType:2},{token:'test',fetcher})).ok,false);assert.equal(calls.length,2);
});

test('simulated return submission reserves once and requires exact readback',async()=>{
 const {simulateDisputeSubmission}=await import('../lib/routes/shopify-return-audit.js');
 const draft={ok:true,submissionAllowed:false,payload:{orderId:'CJ123',businessDisputeId:'RET123'}};
 for(const scenario of ['ok','duplicate','timeout','wrong-order','persist-failure']){
  let writes=0,reads=0,saves=0;const result=await simulateDisputeSubmission(draft,{reserve:async()=>scenario!=='duplicate',submitMock:async()=>{writes++;if(scenario==='timeout')throw Error('timeout');return {ok:true,disputeId:'SH12345'};},readMock:async()=>{reads++;return {ok:true,disputeId:'SH12345',orderId:scenario==='wrong-order'?'CJ999':'CJ123',businessDisputeId:'RET123'};},persist:async()=>{saves++;return scenario!=='persist-failure';}});
  assert.equal(result.ok,scenario==='ok');assert.equal(result.simulated,true);assert.equal(result.customerRefundAuthorized,false);assert.equal(result.automaticRetry,false);assert.equal(writes,scenario==='duplicate'?0:1);assert.equal(reads,['duplicate','timeout'].includes(scenario)?0:1);assert.equal(saves,['ok','persist-failure'].includes(scenario)?1:0);
 }
});

test('customer refund plan never exceeds original payment or verified return entitlement',async()=>{
 const {planCustomerRefund}=await import('../lib/routes/shopify-return-audit.js');
 const x={orderId:'gid://shopify/Order/1',returnId:'gid://shopify/Return/2',currency:'JPY',paidJPY:4400,priorRefundJPY:1000,verifiedReturnAmountJPY:2000,requestedJPY:2000};
 assert.equal(planCustomerRefund(x).ok,true);assert.equal(planCustomerRefund(x).refundAuthorized,false);
 for(const patch of [{requestedJPY:2001},{requestedJPY:0},{requestedJPY:1.5},{priorRefundJPY:3000},{currency:'USD'},{verifiedReturnAmountJPY:null}])assert.equal(planCustomerRefund({...x,...patch}).ok,false);
});
test('simulated customer refund never sends notifications or retries uncertain writes',async()=>{
 const {planCustomerRefund,simulateCustomerRefund}=await import('../lib/routes/shopify-return-audit.js');
 const plan=planCustomerRefund({orderId:'gid://shopify/Order/1',returnId:'gid://shopify/Return/2',currency:'JPY',paidJPY:4400,priorRefundJPY:1000,verifiedReturnAmountJPY:2000,requestedJPY:2000});
 for(const scenario of ['ok','duplicate','timeout','mismatch','persist-failure']){
  let writes=0;const id='gid://shopify/Refund/3';const r=await simulateCustomerRefund(plan,{reserve:async(key)=>{assert.equal(key,plan.orderId);return scenario!=='duplicate';},refundMock:async()=>{writes++;if(scenario==='timeout')throw Error('timeout');return {ok:true,refundId:id};},readMock:async()=>({...plan,refundId:id,status:'SUCCESS',amountJPY:scenario==='mismatch'?1999:2000}),persist:async()=>scenario!=='persist-failure'});
  assert.equal(r.ok,scenario==='ok');assert.equal(r.notificationAllowed,false);assert.equal(r.automaticRetry,false);assert.equal(writes,scenario==='duplicate'?0:1);assert.equal(Boolean(r.notificationPreview),scenario==='ok');
 }
});
