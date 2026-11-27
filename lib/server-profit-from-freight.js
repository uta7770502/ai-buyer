import {estimateProfit} from './profit-estimate.js';

// Only call with a CJ freight response obtained inside the trusted server request.
// Never use this function to elevate a browser-supplied response to verified status.
export function estimateProfitFromServerFreight(freight,costs,{now=Date.now(),expectedVid,expectedDestination='JP'}={}){
 const fail=reason=>({ready:false,profitJpy:null,marginPercent:null,reason});
 if(!freight||freight.ok!==true||freight.quoteSource!=='cj-server'||!['JP','US','GB','AU','DE'].includes(expectedDestination)||freight.destination!==expectedDestination||freight.currency!=='USD')return fail('CJの指定配送先向け送料見積が未確認です');
 if(!expectedVid||String(freight.vid)!==String(expectedVid))return fail('商品バリエーションが一致しません');
 if(freight.shippingJpyVerified!==true||freight.fxVerified!==true||freight.fxSource!=='open.er-api.com')return fail('送料・為替の確認が完了していません');
 const checked=Date.parse(freight.fetchedAt||''),fxChecked=Date.parse(freight.fxVerifiedAt||'');
 if(!Number.isFinite(checked)||!Number.isFinite(fxChecked)||checked>now||fxChecked>now||now-checked>900000||now-fxChecked>900000)return fail('送料または為替の確認期限が切れています');
 const options=Array.isArray(freight.options)?freight.options:[];
 const first=options[0];
 const jpy=freight.shippingCostJpy;
 if(!first||!Number.isSafeInteger(jpy)||jpy<0||!Number.isFinite(first.usd)||!Number.isFinite(freight.usdJpyRate)||freight.usdJpyRate<=0||jpy!==Math.ceil(first.usd*freight.usdJpyRate)||first.jpy!==jpy)return fail('送料と為替の計算結果が一致しません');
 const base=estimateProfit({...costs,shippingCostJpy:jpy,shippingVerified:true,shippingSource:'cj-server',shippingVerifiedAt:freight.fetchedAt},{now});
 if(expectedDestination==='JP')return base;
 // Overseas quotes exclude potentially merchant-borne import duties, taxes and
 // cross-border fees. Require explicit estimates; never default unknown costs to zero.
 const amount=value=>{
  if(typeof value==='string'&&!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim()))return null;
  if(typeof value!=='number'&&typeof value!=='string')return null;
  const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=10000000?Math.ceil(n):null;
 };
 const duty=amount(costs?.importDutyEstimateJpy),tax=amount(costs?.importTaxEstimateJpy),other=amount(costs?.crossBorderFeeEstimateJpy);
 const missing=[];
 if(duty===null)missing.push('関税負担見込');
 if(tax===null)missing.push('輸入税負担見込');
 if(other===null)missing.push('海外取引追加費用見込');
 if(missing.length||!base.ready)return {...base,ready:false,profitJpy:null,marginPercent:null,missing:[...(base.missing||[]),...missing],destination:expectedDestination,estimateOnly:true,landedCostVerified:false,approvalEligible:false};
 // Recalculate from unrounded costs rather than a rounded margin.
 const adjusted=estimateProfit({...costs,adCostPerOrderJpy:base.breakdown.adCostJpy+duty+tax+other,shippingCostJpy:jpy,shippingVerified:true,shippingSource:'cj-server',shippingVerifiedAt:freight.fetchedAt},{now});
 return {...adjusted,destination:expectedDestination,estimateOnly:true,landedCostVerified:false,approvalEligible:false,...(adjusted.ready?{breakdown:{...adjusted.breakdown,adCostJpy:base.breakdown.adCostJpy,importDutyEstimateJpy:duty,importTaxEstimateJpy:tax,crossBorderFeeEstimateJpy:other}}:{})};
}
