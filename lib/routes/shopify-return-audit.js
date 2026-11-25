import { getShopifyAuthContext } from '../shopify-auth-context.js';

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
  const amount=d.refundAmount??null;
  if(amount!==null&&(typeof amount!=='number'||!Number.isFinite(amount)||amount<0))return {ok:false,reason:'cj-dispute-unverified'};
  // Requested dispute amount and approved supplier refund may differ.
  if(d.money!=null&&(typeof d.money!=='number'||!Number.isFinite(d.money)||d.money<0))return {ok:false,reason:'cj-dispute-unverified'};
  const outcome=d.finallyDeal??null;
  if(outcome!==null&&![1,2,3].includes(outcome))return {ok:false,reason:'cj-dispute-unverified'};
  return {ok:true,readOnly:true,disputeId,status:d.status,reportedSupplierRefundUSD:amount,requestedDisputeUSD:d.money??null,negotiationOutcome:({1:'refund',2:'reissue',3:'reject'})[outcome]||null,shopifyOrderLinkVerified:false,supplierRefundReceivedVerified:false,customerRefundAuthorized:false,returnDestinationVerified:false};
 }catch{return {ok:false,reason:'cj-dispute-unavailable'}}
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
    // Optional independent lookup: no order association or refund authority is inferred.
    const supplierDispute=disputeId===undefined?null:await readSupplierDispute(disputeId,{token:process.env.CJ_ACCESS_TOKEN});
    return res.status(200).json({ok:true,readOnly:true,testOrder:o.test,supplierDispute,returnCount:rows.length,pendingCount:rows.filter(r=>['OPEN','REQUESTED'].includes(r.status)).length,rows,
      reviewQueue:rows.filter(r=>r.reviewRequired).map(r=>({returnId:r.id,nextAction:r.nextAction,requiredEvidence:r.requiredEvidence})),supplierReturnTermsVerified:false,returnDestinationVerified:false,refundIssued:false,returnCreated:false,customerNotified:false});
  }catch{return res.status(503).json({ok:false,readOnly:true,error:'返品情報を確認できません'})}
}
