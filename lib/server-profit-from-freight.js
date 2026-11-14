import {estimateProfit} from './profit-estimate.js';

// Only call with a CJ freight response obtained inside the trusted server request.
// Never use this function to elevate a browser-supplied response to verified status.
export function estimateProfitFromServerFreight(freight,costs,{now=Date.now(),expectedVid}={}){
 const fail=reason=>({ready:false,profitJpy:null,marginPercent:null,reason});
 if(!freight||freight.ok!==true||freight.quoteSource!=='cj-server'||freight.destination!=='JP'||freight.currency!=='USD')return fail('CJの日本向け送料見積が未確認です');
 if(!expectedVid||String(freight.vid)!==String(expectedVid))return fail('商品バリエーションが一致しません');
 if(freight.shippingJpyVerified!==true||freight.fxVerified!==true||freight.fxSource!=='open.er-api.com')return fail('送料・為替の確認が完了していません');
 const checked=Date.parse(freight.fetchedAt||''),fxChecked=Date.parse(freight.fxVerifiedAt||'');
 if(!Number.isFinite(checked)||!Number.isFinite(fxChecked)||checked>now||fxChecked>now||now-checked>900000||now-fxChecked>900000)return fail('送料または為替の確認期限が切れています');
 const options=Array.isArray(freight.options)?freight.options:[];
 const first=options[0];
 const jpy=freight.shippingCostJpy;
 if(!first||!Number.isSafeInteger(jpy)||jpy<0||!Number.isFinite(first.usd)||!Number.isFinite(freight.usdJpyRate)||freight.usdJpyRate<=0||jpy!==Math.ceil(first.usd*freight.usdJpyRate)||first.jpy!==jpy)return fail('送料と為替の計算結果が一致しません');
 return estimateProfit({...costs,shippingCostJpy:jpy,shippingVerified:true,shippingSource:'cj-server',shippingVerifiedAt:freight.fetchedAt},{now});
}
