'use strict';
// Standalone fail-closed decision for a product's proposed margin exception.
// This helper does not publish products; registration must call it at the final gate.
const { verifiedMarginAtLeast } = require('./verified-profit.cjs');
function verifiedAuthorizedMargin(input, approval) {
  const standard = verifiedMarginAtLeast(input, 30);
  if (standard.allowed) return { allowed: true, threshold: 30, reason: 'standard_margin_met' };
  if (standard.reason !== 'margin_below_threshold')
    return { allowed: false, reason: standard.reason };
  if (!approval || approval.approved !== true ||
      (approval.threshold !== 25 && approval.threshold !== 20) ||
      typeof approval.sku !== 'string' || !approval.sku.trim() ||
      typeof input?.sku !== 'string' || approval.sku !== input.sku ||
      typeof approval.approvedBy !== 'string' || !approval.approvedBy.trim() ||
      typeof approval.approvedAt !== 'string' || !approval.approvedAt.trim())
    return { allowed: false, reason: 'exception_approval_missing' };
  const timestamp = Date.parse(approval.approvedAt);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() || Date.now() - timestamp > 30 * 24 * 60 * 60 * 1000)
    return { allowed: false, reason: 'exception_approval_invalid_time' };
  const exception = verifiedMarginAtLeast(input, approval.threshold);
  return { allowed: exception.allowed, reason: exception.allowed ? 'approved_exception_margin_met' : exception.reason,
    ...(exception.allowed ? { threshold: approval.threshold } : {}) };
}
module.exports = { verifiedAuthorizedMargin };
