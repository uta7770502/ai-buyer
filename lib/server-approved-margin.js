import {loadMarginException} from './server-margin-exception.js';
import {assessVerifiedProductMargin} from './verified-product-margin.js';

// Call only with supplier, fee and freight evidence retrieved from trusted server integrations.
// Never forward a browser-supplied marginException into the verified assessment.
export async function assessMarginWithStoredApproval(evidence,{now=Date.now()}={}){
 // Never coerce strings, booleans, or null into an approved margin tier.
 const threshold=evidence?.threshold===undefined?25:evidence.threshold;
 const expectedVid=String(evidence?.expectedVid||'');
 const marginException=([20,15].includes(threshold))?await loadMarginException(expectedVid,{now}):undefined;
 const approvedThreshold=threshold===25||Boolean(marginException&&marginException.threshold===threshold);
 return assessVerifiedProductMargin({...evidence,threshold,marginException:approvedThreshold?marginException:undefined},{now});
}
