'use strict';
// Pure calculation only. Never trusts CJ discovery prices as verified costs.
// A caller must independently verify the source, currency, shipping destination,
// stock, fees, and freshness before setting the verification flags.
function verifiedProfit(input) {
  const required = ['salePriceJpy','productCostJpy','shippingJpy','paymentFeeJpy','platformFeeJpy','plannedAdCostJpy','returnReserveJpy'];
  if (!input || input.costSourceVerified !== true || input.jpShippingVerified !== true || input.feesVerified !== true) {
    return { contributionMarginVerified:false, finalProfitVerified:false, reason:'verification_missing' };
  }
  if (required.some(k => typeof input[k] !== 'number' || !Number.isFinite(input[k]) || input[k] < 0) || input.salePriceJpy <= 0) {
    return { contributionMarginVerified:false, finalProfitVerified:false, reason:'invalid_amount' };
  }
  const {salePriceJpy:s,productCostJpy:c,shippingJpy:sh,paymentFeeJpy:pay,platformFeeJpy:platform,plannedAdCostJpy:ads,returnReserveJpy:returns}=input;
  const finalProfitJpy = s-c-sh-pay-platform-ads-returns;
  const verifiedContributionMarginPercent = 100*finalProfitJpy/s;
  return {
    contributionMarginVerified:true,
    finalProfitVerified:true,
    verifiedContributionMarginPercent,
    finalProfitJpy,
    reason: finalProfitJpy > 0 ? 'calculated' : 'non_positive_profit'
  };
}
module.exports={verifiedProfit};
