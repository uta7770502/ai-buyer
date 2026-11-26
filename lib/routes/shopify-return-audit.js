import { getShopifyAuthContext } from '../shopify-auth-context.js';
import { linkedSandboxOrder } from '../sandbox-order.js';
import { getCJAccessToken } from '../cj-access-token.js';

const STATUSES=new Set(['REQUESTED','OPEN','CLOSED','DECLINED','CANCELED']);
export function summarizeReturns(connection){
  if(connection?.pageInfo?.hasNextPage!==false||!Array.isArray(connection.nodes))return null;
  const seen=new Set(),rows=[];
  for(const r of connection.nodes){
    if(!/^gid:\/\/shopify\/Return\/[1-9]\d*$/.test(String(r?.id||''))||seen.has(r.id)||!STATUSES.has(r.status)||!Number.isSafeInteger(r.totalQuantity)||r.totalQuantity<1)return null;
    seen.add(r.id);
    rows.push({id:r.id,status:r.status,quantity:r.totalQuantity,
      nextAction:r.status==='REQUESTED'?'review_request_and_supplier_terms':r.status==='OPEN'?'verify_return_destination_and_supplier_response':'reconcile_closed_record',
      reviewRequired:['REQUESTED','OPEN'].includes(r.status),
      requiredEvidence:r.status==='REQUESTED'?['merchant_return_policy','customer_request_reason','supplier_return_eligibility']:r.status==='OPEN'?['supplier_case_reference','verified_return_destination','refund_amount_review']:[],
      automaticRefundAllowed:false,automaticReturnAllowed:false});
  }
  return rows;
}
// Read-only supplier dispute lookup. A CJ outcome is never customer refund authorization.
export async function readSupplierDispute(disputeId,{token,fetcher=fetch}={}){
 if(typeof disputeId!=='string'||!/^SH[A-Za-z0-9_-]{3,98}$/.test(disputeId)||typeof token!=='string'||!token.trim())return {ok:false,reason:'invalid-dispute-input'};
 try{
  const u=new URL('https://developers.cjdropshipping.com/api2.0/v1/disputes/getDisputeDetail');
  u.searchParams.set('disputeId',disputeId);
  const r=await fetcher(u,{method:'GET',headers:{'CJ-Access-Token':token},signal:AbortSignal.timeout(8000)});
  if(!r.ok)return {ok:false,reason:r.status===429?'cj-rate-limited':'cj-dispute-unavailable'};
  const j=await r.json(),d=j?.data;
  if(j?.code!==200||j.result!==true||d?.id!==disputeId||typeof d.status!=='string'||!d.status.trim()||d.status.length>50)return {ok:false,reason:'cj-dispute-unverified'};
  const amount=d.refundAmount??d.money??null;
  if(amount!==null&&(typeof amount!=='number'||!Number.isFinite(amount)||amount<0))return {ok:false,reason:'cj-dispute-unverified'};
  // CJ documents money and refundAmount as aliases of the final supplier refund.
  if(d.money!=null&&(typeof d.money!=='number'||!Number.isFinite(d.money)||d.money<0))return {ok:false,reason:'cj-dispute-unverified'};
  if(d.money!=null&&d.refundAmount!=null&&d.money!==d.refundAmount)return {ok:false,reason:'cj-dispute-unverified'};
  const outcome=d.finallyDeal??null;
  if(outcome!==null&&![1,2,3].includes(outcome))return {ok:false,reason:'cj-dispute-unverified'};
  return {ok:true,readOnly:true,disputeId,status:d.status,reportedSupplierRefundUSD:amount,requestedDisputeUSD:null,negotiationOutcome:({1:'refund',2:'reissue',3:'reject'})[outcome]||null,shopifyOrderLinkVerified:false,supplierRefundReceivedVerified:false,customerRefundAuthorized:false,returnDestinationVerified:false};
 }catch{return {ok:false,reason:'cj-dispute-unavailable'}}
}

// A dispute may belong to another order under the same CJ account.
export function matchesLinkedDispute(linked,disputeId){
 if(!linked||typeof linked.id!=='string'||!linked.id||!linked.data||typeof disputeId!=='string'||!/^SH[A-Za-z0-9_-]{3,98}$/.test(disputeId))return false;
 const ids=[linked.data.disputeId,linked.data.disputeOpenedId].filter(v=>v!==null&&v!==undefined&&v!=='');
 return ids.length>0&&ids.every(v=>typeof v==='string'&&v===disputeId);
}

// Draft only: inputs must be obtained from verified order and CJ confirmation.
export function buildDisputeDraft({orderId,businessDisputeId,disputeReasonId,expectType,refundType,messageText,items,confirmedItems,allowedReasonIds}={}){
 const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{3,100}$/.test(x);
 const positive=x=>Number.isSafeInteger(x)&&x>0&&x<=2147483647;
 const price=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1000000&&Math.abs(x*100-Math.round(x*100))<0.000001;
 const fail=()=>({ok:false,reason:'dispute-draft-unverified',submissionAllowed:false});
 if(!id(orderId)||!id(businessDisputeId)||!positive(disputeReasonId)||!Array.isArray(allowedReasonIds)||!allowedReasonIds.includes(disputeReasonId)||![1,2].includes(expectType)||![1,2].includes(refundType)||typeof messageText!=='string'||!messageText.trim()||messageText.length>500||!Array.isArray(items)||!items.length||items.length>100||!Array.isArray(confirmedItems))return fail();
 const confirmed=new Map();
 for(const x of confirmedItems){if(!id(x?.lineItemId)||confirmed.has(x.lineItemId)||!positive(x.quantity)||!price(x.price))return fail();confirmed.set(x.lineItemId,x);}
 const seen=new Set(),productInfoList=[];
 for(const x of items){const row=confirmed.get(x?.lineItemId);if(!row||seen.has(x.lineItemId)||!positive(x.quantity)||x.quantity>row.quantity)return fail();seen.add(x.lineItemId);productInfoList.push({lineItemId:x.lineItemId,quantity:x.quantity,price:row.price});}
 return {ok:true,readOnly:true,submissionAllowed:false,customerRefundAuthorized:false,payload:{orderId,businessDisputeId,disputeReasonId,expectType,refundType,messageText:messageText.trim(),productInfoList}};
}

// Read eligible CJ order lines; never create a dispute here.
export async function readDisputableProducts(orderId,{token,fetcher=fetch}={}){
 const fail=reason=>({ok:false,reason,submissionAllowed:false});
 if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{3,100}$/.test(orderId)||typeof token!=='string'||!token.trim())return fail('invalid-order-input');
 try{
  const u=new URL('https://developers.cjdropshipping.com/api2.0/v1/disputes/disputeProducts');
  u.searchParams.set('orderId',orderId);
  const r=await fetcher(u,{method:'GET',headers:{'CJ-Access-Token':token},signal:AbortSignal.timeout(8000)});
  if(!r.ok)return fail(r.status===429?'cj-rate-limited':'cj-products-unavailable');
  const j=await r.json(),d=j?.data;
  if(j?.code!==200||j.result!==true||d?.orderId!==orderId||!Array.isArray(d.productInfoList)||d.productInfoList.length>100)return fail('cj-products-unverified');
  const seen=new Set(),items=[];
  for(const x of d.productInfoList){
   if(typeof x?.lineItemId!=='string'||!/^[A-Za-z0-9_-]{3,100}$/.test(x.lineItemId)||seen.has(x.lineItemId)||typeof x.canChoose!=='boolean'||!Number.isSafeInteger(x.quantity)||x.quantity<1||typeof x.price!=='number'||!Number.isFinite(x.price)||x.price<0||x.price>1000000||Math.abs(x.price*100-Math.round(x.price*100))>0.000001)return fail('cj-products-unverified');
   seen.add(x.lineItemId);
   if(x.canChoose)items.push({lineItemId:x.lineItemId,quantity:x.quantity,price:x.price});
  }
  return {ok:true,readOnly:true,orderId,eligibleItems:items,currency:'USD',submissionAllowed:false};
 }catch{return fail('cj-products-unavailable')}
}

// Confirmation is a preflight POST, not the dispute creation endpoint.
export async function confirmDisputeTerms(orderId,selected,{token,fetcher=fetch}={}){
 const fail=reason=>({ok:false,reason,submissionAllowed:false});
 const money=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1000000&&Math.abs(x*100-Math.round(x*100))<0.000001;
 if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{3,100}$/.test(orderId)||typeof token!=='string'||!token.trim()||!Array.isArray(selected)||!selected.length||selected.length>100)return fail('invalid-confirm-input');
 const ids=new Set();
 for(const x of selected){if(typeof x?.lineItemId!=='string'||!/^[A-Za-z0-9_-]{3,100}$/.test(x.lineItemId)||ids.has(x.lineItemId)||!Number.isSafeInteger(x.quantity)||x.quantity<1||!money(x.price))return fail('invalid-confirm-input');ids.add(x.lineItemId);}
 try{
  const r=await fetcher('https://developers.cjdropshipping.com/api2.0/v1/disputes/disputeConfirmInfo',{method:'POST',headers:{'CJ-Access-Token':token,'Content-Type':'application/json'},body:JSON.stringify({orderId,productInfoList:selected.map(({lineItemId,quantity,price})=>({lineItemId,quantity,price}))}),signal:AbortSignal.timeout(8000)});
  if(!r.ok)return fail('cj-confirm-unavailable');
  const j=await r.json(),d=j?.data;
  if(j?.code!==200||j.result!==true||d?.orderId!==orderId||!Array.isArray(d.productInfoList)||d.productInfoList.length!==selected.length||!Array.isArray(d.expectResultOptionList)||!d.expectResultOptionList.length||!d.expectResultOptionList.every(x=>['1','2'].includes(x))||!Array.isArray(d.disputeReasonList)||!d.disputeReasonList.length||!['maxProductPrice','maxPostage','maxIossTaxAmount','maxIossHandTaxAmount','maxAmount'].every(k=>money(d[k])))return fail('cj-confirm-unverified');
  const seen=new Set();
  for(const x of d.productInfoList){const s=selected.find(y=>y.lineItemId===x?.lineItemId);if(!s||seen.has(x.lineItemId)||x.quantity!==s.quantity||x.price!==s.price)return fail('cj-confirm-unverified');seen.add(x.lineItemId);}
  const reasons=new Set();
  for(const x of d.disputeReasonList){if(!Number.isSafeInteger(x?.disputeReasonId)||x.disputeReasonId<1||reasons.has(x.disputeReasonId)||typeof x.reasonName!=='string'||!x.reasonName.trim()||x.reasonName.length>200)return fail('cj-confirm-unverified');reasons.add(x.disputeReasonId);}
  return {ok:true,readOnly:true,orderId,currency:'USD',maxRefundUSD:d.maxAmount,allowedExpectTypes:[...new Set(d.expectResultOptionList.map(Number))],reasons:d.disputeReasonList.map(({disputeReasonId,reasonName})=>({disputeReasonId,reasonName})),submissionAllowed:false,customerRefundAuthorized:false};
 }catch{return fail('cj-confirm-unavailable')}
}

// Orchestrate verified supplier preflight only; never transmit a dispute creation request.
export async function prepareDisputeDraft(input,{token,fetcher=fetch}={}){
 const fail=reason=>({ok:false,reason,submissionAllowed:false,customerRefundAuthorized:false});
 if(!input||!Array.isArray(input.items)||input.items.length<1||input.items.length>100)return fail('invalid-draft-input');
 const eligibility=await readDisputableProducts(input.orderId,{token,fetcher});
 if(!eligibility.ok)return fail(eligibility.reason);
 const seen=new Set(),selected=[];
 for(const x of input.items){
  const row=eligibility.eligibleItems.find(y=>y.lineItemId===x?.lineItemId);
  if(!row||seen.has(x.lineItemId)||!Number.isSafeInteger(x.quantity)||x.quantity<1||x.quantity>row.quantity)return fail('selected-lines-unverified');
  seen.add(x.lineItemId);selected.push({lineItemId:x.lineItemId,quantity:x.quantity,price:row.price});
 }
 const terms=await confirmDisputeTerms(input.orderId,selected,{token,fetcher});
 if(!terms.ok)return fail(terms.reason);
 if(!terms.allowedExpectTypes.includes(input.expectType))return fail('supplier-outcome-not-allowed');
 const draft=buildDisputeDraft({...input,items:selected,confirmedItems:selected,allowedReasonIds:terms.reasons.map(r=>r.disputeReasonId)});
 if(!draft.ok)return fail(draft.reason);
 return {...draft,terms,orderLinkVerified:false,shopifyReturnLineLinkVerified:false,submissionAllowed:false,customerRefundAuthorized:false};
}

// Simulation only: injected functions are never connected to a live submission route.
export async function simulateDisputeSubmission(draft,{reserve,submitMock,readMock,persist}={}){
 const fail=(reason,needsReview=false)=>({ok:false,reason,needsReview,automaticRetry:false,simulated:true,customerRefundAuthorized:false});
 if(draft?.ok!==true||draft.submissionAllowed!==false||!draft.payload||typeof reserve!=='function'||typeof submitMock!=='function'||typeof readMock!=='function'||typeof persist!=='function')return fail('invalid-simulation');
 const {orderId,businessDisputeId}=draft.payload;
 if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{3,100}$/.test(orderId)||typeof businessDisputeId!=='string'||!/^[A-Za-z0-9_-]{3,100}$/.test(businessDisputeId))return fail('invalid-simulation');
 const key=orderId+':'+businessDisputeId;
 try{if(await reserve(key)!==true)return fail('already-reserved',true);}catch{return fail('reservation-unavailable',true);}
 try{
  const result=await submitMock(draft.payload);
  if(result?.ok!==true||typeof result.disputeId!=='string'||!/^SH[A-Za-z0-9_-]{3,98}$/.test(result.disputeId))return fail('submission-unconfirmed',true);
  const detail=await readMock(result.disputeId);
  if(detail?.ok!==true||detail.disputeId!==result.disputeId||detail.orderId!==orderId||detail.businessDisputeId!==businessDisputeId)return fail('readback-unconfirmed',true);
  if(await persist(key,{state:'simulated-confirmed',disputeId:result.disputeId})!==true)return fail('persistence-unconfirmed',true);
  return {ok:true,simulated:true,disputeId:result.disputeId,customerRefundAuthorized:false,automaticRetry:false};
 }catch{return fail('outcome-unconfirmed',true);}
}

// JPY-only simulated refund calculation. CJ USD compensation is not the customer entitlement.
export function planCustomerRefund({orderId,returnId,currency,paidJPY,priorRefundJPY,verifiedReturnAmountJPY,requestedJPY}={}){
 const fail=()=>({ok:false,reason:'refund-amount-unverified',refundAuthorized:false});
 if(!/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(String(orderId||''))||!/^gid:\/\/shopify\/Return\/[1-9]\d*$/.test(String(returnId||''))||currency!=='JPY'||![paidJPY,priorRefundJPY,verifiedReturnAmountJPY,requestedJPY].every(x=>Number.isSafeInteger(x)&&x>=0)||priorRefundJPY>paidJPY||requestedJPY<1||requestedJPY>paidJPY-priorRefundJPY||requestedJPY>verifiedReturnAmountJPY)return fail();
 return {ok:true,simulated:true,orderId,returnId,currency,amountJPY:requestedJPY,remainingBeforeJPY:paidJPY-priorRefundJPY,verifiedReturnAmountJPY,refundAuthorized:false};
}
// Simulation only; reservation is order-wide to avoid concurrent refunds across returns.
export async function simulateCustomerRefund(plan,{reserve,refundMock,readMock,persist}={}){
 const fail=reason=>({ok:false,reason,simulated:true,automaticRetry:false,notificationAllowed:false});
 if(plan?.ok!==true||plan.simulated!==true||plan.refundAuthorized!==false||!Number.isSafeInteger(plan.amountJPY)||plan.amountJPY<1||!Number.isSafeInteger(plan.remainingBeforeJPY)||!Number.isSafeInteger(plan.verifiedReturnAmountJPY)||plan.amountJPY>plan.remainingBeforeJPY||plan.amountJPY>plan.verifiedReturnAmountJPY||plan.currency!=='JPY'||!/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(plan.orderId)||!/^gid:\/\/shopify\/Return\/[1-9]\d*$/.test(plan.returnId)||![reserve,refundMock,readMock,persist].every(x=>typeof x==='function'))return fail('invalid-plan');
 try{
  if(await reserve(plan.orderId)!==true)return fail('refund-reserved');
  const result=await refundMock(plan);
  if(result?.ok!==true||!/^gid:\/\/shopify\/Refund\/[1-9]\d*$/.test(String(result.refundId||'')))return fail('refund-unconfirmed');
  const read=await readMock(result.refundId);
  if(read?.refundId!==result.refundId||read.orderId!==plan.orderId||read.returnId!==plan.returnId||read.currency!==plan.currency||read.amountJPY!==plan.amountJPY||read.status!=='SUCCESS')return fail('refund-readback-unconfirmed');
  if(await persist(plan.orderId,{refundId:result.refundId,returnId:plan.returnId,amountJPY:plan.amountJPY,state:'simulated-confirmed'})!==true)return fail('refund-persistence-unconfirmed');
  return {ok:true,simulated:true,refundId:result.refundId,automaticRetry:false,notificationAllowed:false,notificationPreview:'返金手続きが完了しました。返金額：'+plan.amountJPY+'円',customerNotified:false};
 }catch{return fail('refund-outcome-unconfirmed')}
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
  if(!admin||req.headers?.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  const orderId=String(req.query?.orderId||'').trim();
  if(!/^[1-9]\d{0,29}$/.test(orderId))return res.status(400).json({ok:false,error:'Shopify注文IDを確認してください'});
  const auth=await getShopifyAuthContext(req);
  if(!auth.ok)return res.status(auth.status).json({ok:false,error:auth.error});
  try{
    const response=await fetch('https://'+auth.shop+'/admin/api/2026-10/graphql.json',{
      method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':auth.token},
      body:JSON.stringify({query:'query ReturnAudit($id:ID!){order(id:$id){id test returns(first:50){pageInfo{hasNextPage} nodes{id status totalQuantity}}}}',variables:{id:'gid://shopify/Order/'+orderId}}),
      signal:AbortSignal.timeout(8000)
    });
    const j=await response.json();
    if(!response.ok||!j||typeof j!=='object'||(Object.hasOwn(j,'errors')&&(!Array.isArray(j.errors)||j.errors.length>0)))return res.status(503).json({ok:false,readOnly:true,error:'Shopify返品データを取得できません。返品の読み取り権限を確認してください'});
    const o=j.data?.order;
    if(!o||o.id!=='gid://shopify/Order/'+orderId||typeof o.test!=='boolean')return res.status(409).json({ok:false,readOnly:true,error:'対象注文を確認できません'});
    const rows=summarizeReturns(o.returns);
    if(!rows)return res.status(409).json({ok:false,readOnly:true,error:'返品情報が不完全です。自動処理せず確認してください'});
    const disputeId=req.query?.disputeId;
    if(disputeId!==undefined&&(!o.test||!rows.some(r=>r.reviewRequired)))return res.status(409).json({ok:false,readOnly:true,error:'返品照会は未解決のテスト注文に限定されています'});
    let supplierDispute=null;
    const checkEligibility=req.query?.checkSupplierEligibility==='true';
    if(checkEligibility&&(!o.test||!rows.some(r=>r.status==='REQUESTED')))return res.status(409).json({ok:false,readOnly:true,error:'返品対象照会は申請中のテスト注文に限定されています'});
    let linked=null,cjToken=null;
    if(disputeId!==undefined||checkEligibility){
      linked=await linkedSandboxOrder(auth.shop,orderId);
      if(!linked||typeof linked.id!=='string'||!/^[A-Za-z0-9_-]{3,100}$/.test(linked.id)||linked.data?.orderId!==linked.id)return res.status(409).json({ok:false,readOnly:true,error:'CJ注文との紐付けを確認できません'});
      if(disputeId!==undefined&&!matchesLinkedDispute(linked,disputeId))return res.status(409).json({ok:false,readOnly:true,error:'CJ返品案件と対象注文の紐付けを確認できません'});
      cjToken=await getCJAccessToken();
    }
    if(disputeId!==undefined){
      const detail=await readSupplierDispute(disputeId,{token:cjToken});
      supplierDispute=detail.ok?{...detail,shopifyOrderLinkVerified:true}:detail;
    }
    let supplierEligibility=null;
    if(checkEligibility){
      supplierEligibility=await readDisputableProducts(linked.id,{token:cjToken});
    }
    return res.status(200).json({ok:true,readOnly:true,testOrder:o.test,supplierEligibility,supplierDispute,returnCount:rows.length,pendingCount:rows.filter(r=>['OPEN','REQUESTED'].includes(r.status)).length,rows,
      reviewQueue:rows.filter(r=>r.reviewRequired).map(r=>({returnId:r.id,nextAction:r.nextAction,requiredEvidence:r.requiredEvidence})),supplierReturnTermsVerified:false,returnDestinationVerified:false,refundIssued:false,returnCreated:false,customerNotified:false});
  }catch{return res.status(503).json({ok:false,readOnly:true,error:'返品情報を確認できません'})}
}
