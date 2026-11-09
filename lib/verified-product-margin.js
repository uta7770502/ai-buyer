import {estimateProfitFromServerFreight} from './server-profit-from-freight.js';

// Server-only assessment. Evidence must be retrieved from trusted integrations,
// never copied from browser input or a CJ search-list price.
export function assessVerifiedProductMargin({freight,expectedVid,supplier,fees,advertising,returns,salePriceJpy,threshold=30}={}, {now=Date.now()}={}){
 const reject=(reason,estimate=null)=>({approved:false,finalProfitVerified:false,contributionMarginVerified:false,profitJpy:null,marginPercent:null,reason,estimate});
 if(![20,25,30].includes(threshold))return reject('利益率基準が不正です');
 if(!expectedVid||!supplier||supplier.source!=='cj-settled-cost'||supplier.verified!==true||String(supplier.vid)!==String(expectedVid))return reject('CJの確定仕入原価が未検証です');
 if(!Number.isSafeInteger(supplier.costJpy)||supplier.costJpy<=0)return reject('確定仕入原価が不正です');
 const checked=Date.parse(supplier.verifiedAt||'');
 if(!Number.isFinite(checked)||checked>now||now-checked>900000)return reject('確定仕入原価の検証期限が切れています');
 if(!fees||fees.verified!==true||fees.source!=='shopify-payment-settings')return reject('決済手数料が未検証です');
 if(!advertising||advertising.approved!==true||advertising.source!=='approved-ad-budget')return reject('広告費の承認済み予算がありません');
 if(!returns||returns.approved!==true||returns.source!=='approved-return-reserve')return reject('返品・返金引当が未承認です');
 const estimate=estimateProfitFromServerFreight(freight,{
  salePriceJpy,productCostJpy:supplier.costJpy,
  paymentFeeRatePercent:fees.ratePercent,paymentFixedFeeJpy:fees.fixedJpy,
  adCostPerOrderJpy:advertising.costPerOrderJpy,returnReservePerOrderJpy:returns.reserveJpy
 },{now,expectedVid});
 if(!estimate.ready)return reject(estimate.reason||estimate.missing?.join('、')||'利益計算が未完了です');
 if(!Number.isSafeInteger(estimate.profitJpy)||estimate.profitJpy<=0||estimate.marginPercent<threshold)return reject('最終利益または利益率が基準未満です',estimate);
 return {approved:true,finalProfitVerified:true,contributionMarginVerified:true,profitJpy:estimate.profitJpy,marginPercent:estimate.marginPercent,threshold,breakdown:estimate.breakdown};
}
