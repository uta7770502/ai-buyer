'use strict';
// Discovery diagnostics only: these counts never grant listing or draft eligibility.
function summarizeDiscovery({received,products,minListed=0,minVerifiedInventory=0}) {
  const raw=Array.isArray(received)?received:[];
  const candidates=Array.isArray(products)?products:[];
  const unique=[...new Map(candidates.filter(p=>p&&p.id!=null&&String(p.id).trim()).map(p=>[String(p.id),p])).values()];
  const listed=unique.filter(p=>minListed<=0||(Number.isFinite(p.listedNum)&&p.listedNum>=minListed));
  const remaining=listed.filter(p=>minVerifiedInventory<=0||(Number.isFinite(p.verifiedInventory)&&p.verifiedInventory>=minVerifiedInventory));
  return {
    products:remaining,
    diagnostics:{
      receivedFromCJ:raw.length,
      missingProductId:raw.length-candidates.length,
      uniqueCandidates:unique.length,
      duplicateIds:candidates.length-unique.length,
      excludedByListingCount:unique.length-listed.length,
      excludedByDiscoveryInventory:listed.length-remaining.length,
      returnedCandidates:remaining.length,
      reviewVerified:false,variantStockVerified:false,jpFreightVerified:false,netProfitVerified:false,
      note:'Discovery counts only. Reviews, exact variant stock, Japan freight and verified net profit are not evaluated by this endpoint.'
    }
  };
}
module.exports={summarizeDiscovery};
