import {loadMarginException} from './server-margin-exception.js';
import {assessVerifiedProductMargin} from './verified-product-margin.js';

// Call only with supplier, fee and freight evidence retrieved from trusted server integrations.
// Never forward a browser-supplied marginException into the verified assessment.
export async function assessMarginWithStoredApproval(evidence,{now=Date.now()}={}){
 const threshold=Number(evidence?.threshold??30);
 const expectedVid=String(evidence?.expectedVid||'');
 const marginException=threshold===30?undefined:await loadMarginException(expectedVid,{now});
 const approvedThreshold=threshold===30||Boolean(marginException&&marginException.threshold===threshold);
 return assessVerifiedProductMargin({...evidence,threshold,marginException:approvedThreshold?marginException:undefined},{now});
}
