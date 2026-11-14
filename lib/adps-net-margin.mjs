// Conservative JPY pricing helpers. No client-provided fee estimate is proof of
// a Shopify payment contract. These helpers never authorize publication.
export function calculateNetMargin({priceYen, costYen, shippingYen, advertisingYen=0, returnsReserveYen=0, fixedFeeYen=0, percentageFee=0}) {
  const amounts=[priceYen,costYen,shippingYen,advertisingYen,returnsReserveYen,fixedFeeYen];
  if(amounts.some(x=>!Number.isSafeInteger(x)||x<0)||!Number.isSafeInteger(priceYen)||priceYen<=0||
    !Number.isFinite(percentageFee)||percentageFee<0||percentageFee>=1) {
    return {ok:false,reason:'invalid-cost-or-fee'};
  }
  // Round fees up, not down, to avoid overstating realized profit.
  const paymentFeeYen=Math.ceil(priceYen*percentageFee)+fixedFeeYen;
  const totalCosts=[costYen,shippingYen,advertisingYen,returnsReserveYen,paymentFeeYen].reduce((sum,x)=>sum+x,0);
  if(!Number.isSafeInteger(paymentFeeYen)||!Number.isSafeInteger(totalCosts))
    return {ok:false,reason:'unsafe-cost-total'};
  const netProfitYen=priceYen-totalCosts;
  if(!Number.isSafeInteger(netProfitYen))
    return {ok:false,reason:'unsafe-net-profit'};
  return {ok:true,netProfitYen,paymentFeeYen,margin:netProfitYen/priceYen};
}
export function evaluateMarginTiers(costs, {feeEvidenceVerified=false,shippingEvidenceVerified=false}={}) {
  if(feeEvidenceVerified!==true||shippingEvidenceVerified!==true) return {eligible:false,reason:'unverified-fees-or-shipping',tier:null};
  const result=calculateNetMargin(costs);
  if(!result.ok)return {eligible:false,reason:result.reason,tier:null};
  const tier=[0.30,0.25,0.20].find(x=>result.margin+1e-12>=x)??null;
  return {eligible:tier!==null,tier,margin:result.margin,netProfitYen:result.netProfitYen,paymentFeeYen:result.paymentFeeYen,reason:tier===null?'below-20-percent':null};
}
