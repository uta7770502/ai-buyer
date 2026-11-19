'use strict';
// Pure calculation only. Never trusts CJ discovery prices as verified costs.
// A caller must independently verify the source, currency, shipping destination,
// stock, fees, and freshness before setting the verification flags.
function verifiedProfit(input) {
  const required = ['salePriceJpy','productCostJpy','shippingJpy','paymentFeeJpy','platformFeeJpy','plannedAdCostJpy','returnReserveJpy'];
  if (!input || input.costSourceVerified !== true || input.jpShippingVerified !== true || input.feesVerified !== true) {
    return { contributionMarginVerified:false, finalProfitVerified:false, reason:'verification_missing' };
  }
  if (required.some(k => !Number.isSafeInteger(input[k]) || input[k] < 0) || input.salePriceJpy <= 0) {
    return { contributionMarginVerified:false, finalProfitVerified:false, reason:'invalid_amount' };
  }
  const {salePriceJpy:s,productCostJpy:c,shippingJpy:sh,paymentFeeJpy:pay,platformFeeJpy:platform,plannedAdCostJpy:ads,returnReserveJpy:returns}=input;
  const totalCosts=[c,sh,pay,platform,ads,returns].reduce((sum,value)=>sum+value,0);
  if(!Number.isSafeInteger(totalCosts))
    return { contributionMarginVerified:false, finalProfitVerified:false, reason:'unsafe_cost_total' };
  const finalProfitJpy = s-totalCosts;
  if(!Number.isSafeInteger(finalProfitJpy))
    return { contributionMarginVerified:false, finalProfitVerified:false, reason:'unsafe_net_profit' };
  const verifiedContributionMarginPercent = 100*finalProfitJpy/s;
  return {
    contributionMarginVerified:true,
    finalProfitVerified:true,
    verifiedContributionMarginPercent,
    finalProfitJpy,
    reason: finalProfitJpy > 0 ? 'calculated' : 'non_positive_profit'
  };
}
// Compare a verified net margin without floating-point rounding at the gate.
// Only policy-approved thresholds are supported; exception authorization is
// checked by the caller, never inferred from this numeric comparison.
function verifiedMarginAtLeast(input, thresholdPercent = 30) {
  if (![30, 25, 20].includes(thresholdPercent))
    return { allowed: false, reason: 'invalid_threshold' };
  const result = verifiedProfit(input);
  if (!result.finalProfitVerified || result.finalProfitJpy <= 0)
    return { allowed: false, reason: result.reason };
  const allowed = BigInt(result.finalProfitJpy) * 100n >=
    BigInt(input.salePriceJpy) * BigInt(thresholdPercent);
  return { allowed, reason: allowed ? 'margin_met' : 'margin_below_threshold' };
}
module.exports={verifiedProfit,verifiedMarginAtLeast};
