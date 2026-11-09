import {estimateProfitFromServerFreight} from './server-profit-from-freight.js';

// Server-only assessment. Evidence must be retrieved from trusted integrations,
// never copied from browser input or a CJ search-list price.
export function assessVerifiedProductMargin({freight,expectedVid,supplier,fees,advertising,returns,salePriceJpy,threshold=30,marginException}={}, {now=Date.now()}={}){
 const reject=(reason,estimate=null)=>({approved:false,finalProfitVerified:false,contributionMarginVerified:false,profitJpy:null,marginPercent:null,reason,estimate});
 if(![20,25,30].includes(threshold))return reject('利益率基準が不正です');
 if(threshold<30){
  if(!marginException||marginException.approved!==true||marginException.source!=='product-specific-owner-approval'||String(marginException.vid)!==String(expectedVid)||marginException.threshold!==threshold)return reject('利益率例外のSKU別承認がありません');
  const approvedAt=Date.parse(marginException.approvedAt||'');
  if(!Number.isFinite(approvedAt)||approvedAt>now||now-approvedAt>30*24*60*60*1000)return reject('利益率例外の承認日時が無効または期限切れです');
  if(typeof marginException.approvalId!=='string'||!/^[-a-zA-Z0-9_]{12,100}$/.test(marginException.approvalId))return reject('利益率例外の承認記録がありません');
 }
 if(!expectedVid||!supplier||supplier.source!=='cj-settled-cost'||supplier.verified!==true||String(supplier.vid)!==String(expectedVid))return reject('CJの確定仕入原価が未検証です');
 if(!Number.isSafeInteger(supplier.costJpy)||supplier.costJpy<=0)return reject('確定仕入原価が不正です');
 if(supplier.currency!=='JPY')return reject('確定仕入原価の通貨が日本円で検証されていません');
 const checked=Date.parse(supplier.verifiedAt||'');
 if(!Number.isFinite(checked)||checked>now||now-checked>900000)return reject('確定仕入原価の検証期限が切れています');
 if(!fees||fees.verified!==true||fees.source!=='shopify-payment-settings')return reject('決済手数料が未検証です');
 if(!Number.isFinite(fees.ratePercent)||fees.ratePercent<0||fees.ratePercent>=100||!Number.isSafeInteger(fees.fixedJpy)||fees.fixedJpy<0)return reject('決済手数料の数値が不正です');
 if(fees.currency!=='JPY')return reject('決済手数料の通貨が日本円で検証されていません');
 const feeChecked=Date.parse(fees.verifiedAt||'');
 if(!Number.isFinite(feeChecked)||feeChecked>now||now-feeChecked>24*60*60*1000)return reject('決済手数料の検証期限が切れています');
 if(!advertising||advertising.approved!==true||advertising.source!=='approved-ad-budget')return reject('広告費の承認済み予算がありません');
 if(!returns||returns.approved!==true||returns.source!=='approved-return-reserve')return reject('返品・返金引当が未承認です');
 if(!Number.isSafeInteger(advertising.costPerOrderJpy)||advertising.costPerOrderJpy<0||!Number.isSafeInteger(returns.reserveJpy)||returns.reserveJpy<0)return reject('広告費または返品引当の数値が不正です');
 if(!Number.isSafeInteger(salePriceJpy)||salePriceJpy<=0)return reject('販売価格が不正です');
 const estimate=estimateProfitFromServerFreight(freight,{
  salePriceJpy,productCostJpy:supplier.costJpy,
  paymentFeeRatePercent:fees.ratePercent,paymentFixedFeeJpy:fees.fixedJpy,
  adCostPerOrderJpy:advertising.costPerOrderJpy,returnReservePerOrderJpy:returns.reserveJpy
 },{now,expectedVid});
 if(!estimate.ready)return reject(estimate.reason||estimate.missing?.join('、')||'利益計算が未完了です');
 if(!Number.isSafeInteger(estimate.profitJpy)||estimate.profitJpy<=0||estimate.marginPercent<threshold)return reject('最終利益または利益率が基準未満です',estimate);
 return {approved:true,finalProfitVerified:true,contributionMarginVerified:true,profitJpy:estimate.profitJpy,marginPercent:estimate.marginPercent,threshold,breakdown:estimate.breakdown};
}
