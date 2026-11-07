'use strict';
const {verifiedProfit}=require('./verified-profit.cjs');
// This adapter accepts only independently verified, JPY-denominated values.
// CJ search estimates and unverified currency conversions must not set trust flags.
function applyVerifiedProfit(product, evidence) {
 const p={...product};
 delete p.contributionMarginVerified;
 delete p.finalProfitVerified;
 delete p.verifiedContributionMarginPercent;
 delete p.finalProfitJpy;
 if (!evidence || String(evidence.productId)!==String(p.id) || !p.id) {
   return {...p, profitVerificationReason:'product_mismatch_or_missing'};
 }
 const timestamp=Date.parse(evidence.verifiedAt||'');
 if (!Number.isFinite(timestamp)||timestamp>Date.now()||Date.now()-timestamp>15*60*1000) {
   return {...p,profitVerificationReason:'stale_or_missing_evidence'};
 }
 if (evidence.currency!=='JPY'||evidence.shippingDestination!=='JP') {
   return {...p,profitVerificationReason:'wrong_currency_or_destination'};
 }
 const result=verifiedProfit(evidence);
 return {...p,...result,profitVerificationReason:result.reason,profitVerifiedAt:evidence.verifiedAt};
}
module.exports={applyVerifiedProfit};
