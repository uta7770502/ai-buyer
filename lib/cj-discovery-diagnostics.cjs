'use strict';
// Discovery diagnostics only: these counts never grant listing or draft eligibility.
function summarizeDiscovery({received,products,minListed=0,minVerifiedInventory=0}) {
  const raw=Array.isArray(received)?received:[];
  // Treat malformed or negative filter thresholds as zero; never silently accept NaN.
  const listingFloor=Number.isFinite(minListed)&&minListed>0?minListed:0;
  const inventoryFloor=Number.isFinite(minVerifiedInventory)&&minVerifiedInventory>0?minVerifiedInventory:0;
  const candidates=Array.isArray(products)?products:[];
  const unique=[...new Map(candidates.filter(p=>p&&p.id!=null&&String(p.id).trim()).map(p=>[String(p.id),p])).values()];
  const listed=unique.filter(p=>listingFloor===0||(Number.isFinite(p.listedNum)&&p.listedNum>=listingFloor));
  const remaining=listed.filter(p=>inventoryFloor===0||(Number.isFinite(p.verifiedInventory)&&p.verifiedInventory>=inventoryFloor));
  return {
    products:remaining,
    diagnostics:{
      receivedFromCJ:raw.length,
      missingProductId:raw.filter(p=>!p||!String(p.id??p.pid??p.productId??'').trim()).length,
      uniqueCandidates:unique.length,
      duplicateIds:candidates.length-unique.length,
      excludedByListingCount:unique.length-listed.length,
      excludedByDiscoveryInventory:listed.length-remaining.length,
      returnedCandidates:remaining.length,
      // A zero result with nonzero CJ hits can be caused by discovery filters, not CJ connectivity.
      zeroResultReason: raw.length===0?'cj_returned_no_products':
        unique.length===0?'missing_or_invalid_product_ids':
        listed.length===0?'listing_count_gate':
        remaining.length===0?'discovery_inventory_gate':null,
      blockedByUnverifiedEvidence:remaining.length,
      nextVerification:'SKU-specific CJ stock >= 5, Japan shipping, landed cost, payment fees, reviews and net margin must be verified independently before DRAFT.',
      reviewVerified:false,variantStockVerified:false,jpFreightVerified:false,netProfitVerified:false,
      note:'Discovery counts only. Reviews, exact variant stock, Japan freight and verified net profit are not evaluated by this endpoint.'
    }
  };
}
module.exports={summarizeDiscovery};
