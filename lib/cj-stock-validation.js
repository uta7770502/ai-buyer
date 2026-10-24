/** Reject ambiguous CJ stock data instead of silently converting it to zero. */
export function validateCJStockResponse(response) {
  if (!response || response.result !== true || !Array.isArray(response.data) || response.data.length === 0) {
    return { ok: false, reason: 'invalid-cj-response' };
  }
  let total = 0;
  for (const row of response.data) {
    if (!row || typeof row !== 'object' || Number(row.verifiedWarehouse) !== 1) {
      return { ok: false, reason: 'unverified-warehouse' };
    }
    const raw = row.totalInventoryNum ?? row.totalInventory;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return { ok: false, reason: 'missing-stock' };
    }
    const quantity = Number(raw);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      return { ok: false, reason: 'invalid-stock' };
    }
    total += quantity;
    if (!Number.isSafeInteger(total)) return { ok: false, reason: 'stock-overflow' };
  }
  return { ok: true, total };
}
