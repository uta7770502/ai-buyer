import {normalizeCjFreightQuote} from './cj-freight-quote.js';
import {estimateProfit} from './profit-estimate.js';

// Preview-only composition. Never elevate browser data to verified shipping evidence.
export function estimateProfitFromCjQuote(quote, costs, {expectedVid,now=Date.now()}={}) {
  const freight=normalizeCjFreightQuote(quote,{expectedVid,now});
  const profit=estimateProfit({...costs,shippingCostJpy:freight.shippingCostJpy,shippingVerified:false,shippingSource:'preview',shippingVerifiedAt:null});
  return {freight,profit,ready:false,requiresServerVerification:true};
}
