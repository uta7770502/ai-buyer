export function summarizeStockAudit(rows){
  const blocked=rows.filter(row=>!row.ok).length;
  return {
    variants:rows.length,
    partial:blocked>0,
    noAuditableVariants:rows.length===0,
    allVerified:rows.length>0&&blocked===0,
    inSync:rows.filter(row=>row.ok&&row.cjStock===row.effectiveShopifyStock).length,
    needsSync:rows.filter(row=>row.ok&&row.cjStock!==row.effectiveShopifyStock).length,
    changed:rows.filter(row=>row.changed).length,
    blocked
  };
}
