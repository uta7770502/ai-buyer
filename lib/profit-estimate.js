// Pure profit calculator. All values are JPY, never treated as verified supplier costs.
export function estimateProfit(input={}) {
  const money=(value)=>{
    if(value===null||value===undefined||value==='')return null;
    if(typeof value!=='number'&&!(typeof value==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim())))return null;
    const n=Number(value);
    return Number.isFinite(n)&&n>=0?n:null;
  };
  const price=money(input.salePriceJpy);
  const cost=money(input.productCostJpy);
  const shipping=money(input.shippingCostJpy);
  const feeRate=money(input.paymentFeeRatePercent);
  const fixedFee=money(input.paymentFixedFeeJpy);
  const ads=money(input.adCostPerOrderJpy);
  const reserve=money(input.returnReservePerOrderJpy);
  const missing=[];
  if(price===null||price<=0)missing.push('販売価格');
  if(cost===null)missing.push('仕入原価');
  if(shipping===null||input.shippingVerified!==true)missing.push('日本向け送料（CJ確認済み）');
  if(input.shippingVerified===true&&input.shippingSource!=='cj-server')missing.push('送料のサーバー検証記録');
  if(input.shippingVerified===true&&(!input.shippingVerifiedAt||!Number.isFinite(Date.parse(input.shippingVerifiedAt))))missing.push('送料確認日時');
  if(feeRate===null||feeRate>100)missing.push('決済手数料率');
  if(fixedFee===null)missing.push('決済固定手数料');
  if(ads===null)missing.push('広告費');
  if(reserve===null)missing.push('返品・返金引当');
  if(missing.length)return {ready:false,profitJpy:null,marginPercent:null,missing};
  const paymentFee=price*feeRate/100+fixedFee;
  const profit=price-cost-shipping-paymentFee-ads-reserve;
  return {ready:true,profitJpy:Math.round(profit),marginPercent:Math.round(profit/price*1000)/10,breakdown:{salePriceJpy:price,productCostJpy:cost,shippingCostJpy:shipping,paymentFeeJpy:Math.round(paymentFee),adCostJpy:ads,returnReserveJpy:reserve}};
}
