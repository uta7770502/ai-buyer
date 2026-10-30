/** Validate CJ /product/stock/queryByVid using CJ-managed stock only.
 * Factory-managed stock is not guaranteed to be immediately fulfillable.
 * Reject incomplete, inconsistent, or ambiguous warehouse data.
 */
export function validateCJStockResponse(response) {
  if (!response || response.result !== true || !Array.isArray(response.data) || response.data.length === 0) {
    return { ok: false, reason: 'invalid-cj-response' };
  }
  let total = 0;
  for (const row of response.data) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, reason: 'invalid-warehouse-row' };
    }
    // queryByVid uses cjInventoryNum; verifiedWarehouse belongs to other endpoints.
    for (const key of ['cjInventoryNum', 'factoryInventoryNum', 'totalInventoryNum']) {
      const raw = row[key];
      if (raw === undefined || raw === null || String(raw).trim() === '') {
        return { ok: false, reason: 'missing-stock' };
      }
      if (!/^(0|[1-9][0-9]*)$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) {
        return { ok: false, reason: 'invalid-stock' };
      }
    }
    const cj = Number(row.cjInventoryNum);
    const factory = Number(row.factoryInventoryNum);
    const reportedTotal = Number(row.totalInventoryNum);
    if (!Number.isSafeInteger(cj + factory) || reportedTotal !== cj + factory) {
      return { ok: false, reason: 'inconsistent-stock' };
    }
    if (cj > Number.MAX_SAFE_INTEGER - total) return { ok: false, reason: 'stock-overflow' };
    total += cj;
  }
  return { ok: true, total };
}
