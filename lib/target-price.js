// Pricing proposal only. Never treats unverified estimates as a publish approval.
export function calculateTargetSalePrice(input={}) {
 const money=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
 const cost=money(input.productCostJpy),shipping=money(input.shippingCostJpy);
 const ads=money(input.adCostPerOrderJpy),reserve=money(input.returnReserveJpy);
 const fixed=money(input.paymentFixedFeeJpy),fee=money(input.paymentFeeRatePercent);
 const target=money(input.targetMarginPercent);
 const missing=[];
 if(cost===null)missing.push('仕入原価');
 if(shipping===null||input.shippingVerified!==true)missing.push('CJ確認済み日本向け送料');
 if(ads===null)missing.push('広告費');
 if(reserve===null)missing.push('返品引当');
 if(fixed===null)missing.push('決済固定手数料');
 if(fee===null||fee>=100)missing.push('決済手数料率');
 if(target===null||![20,25,30].includes(target))missing.push('承認済み目標利益率');
 if(missing.length)return {ready:false,priceJpy:null,missing};
 const denominator=1-fee/100-target/100;
 if(denominator<=0)return {ready:false,priceJpy:null,missing:['利益率と手数料率の合計が100%以上']};
 const raw=(cost+shipping+ads+reserve+fixed)/denominator;
 if(!Number.isFinite(raw)||raw<=0||raw>100000000)return {ready:false,priceJpy:null,missing:['計算可能な価格範囲外']};
 const step=100;
 const priceJpy=Math.ceil(raw/step)*step;
 const profit=priceJpy*(1-fee/100)-cost-shipping-ads-reserve-fixed;
 return {ready:true,priceJpy,estimatedProfitJpy:Math.round(profit),estimatedMarginPercent:Math.round(profit/priceJpy*1000)/10,targetMarginPercent:target,verifiedForPublication:false};
}
