/**
 * ODDLY multi-source catalog adapter.
 * This module does NOT scrape DSers/AutoDS or assume access to private APIs.
 * Supply items only through authorized supplier exports/API integrations.
 * Never auto-publish. Unknown/zero stock remains recommendation-only.
 */
export const ACTIVE_SUPPLIERS = Object.freeze(['cj','dsers']);
export const SUPPLIERS = Object.freeze({
  cj: { label: 'CJdropshipping', mode: 'connected' },
  dsers: { label: 'DSers / AliExpress', mode: 'requires_authorized_feed' },
  autods: { label: 'AutoDS', mode: 'disabled_until_later' }
});
const asText = v => String(v ?? '').trim();
const numberOrNull = v => v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
const positive = v => { const n = numberOrNull(v); return n != null && n > 0 ? n : null; };
export function normalizeSupplierProduct(source, raw) {
  if (!SUPPLIERS[source]) throw new Error('Unsupported supplier');
  if (!raw || typeof raw !== 'object') throw new Error('Invalid supplier record');
  const supplierId = asText(raw.supplierProductId ?? raw.productId ?? raw.id);
  if (!supplierId) throw new Error('Missing supplier product ID');
  const inventory = numberOrNull(raw.verifiedInventory ?? raw.inventory ?? raw.stock);
  return {
    source, supplierId, id: source + ':' + supplierId,
    name: asText(raw.name ?? raw.title ?? raw.productName),
    categoryName: asText(raw.categoryName ?? raw.category),
    image: asText(raw.image ?? raw.imageUrl),
    costUsd: positive(raw.costUsd ?? raw.cost),
    shippingJpy: numberOrNull(raw.shippingJpy),
    inventory, stockStatus: inventory == null ? 'unknown' : inventory <= 0 ? 'out_of_stock' : 'in_stock',
    listedNum: numberOrNull(raw.listedNum),
    trending: raw.trending === true,
    reviewRating: numberOrNull(raw.reviewRating),
    reviewCount: numberOrNull(raw.reviewCount),
    japanShippingVerified: raw.japanShippingVerified === true,
    lastVerifiedAt: asText(raw.lastVerifiedAt),
    productUrl: asText(raw.productUrl)
  };
}
export function supplierRecommendationEligibility(p, { minScore = 82, minMargin = 45 } = {}) {
  const reasons = [];
  if (!p.name) reasons.push('商品名未取得');
  if (p.costUsd == null) reasons.push('原価未取得');
  if (p.aiScore == null || p.aiScore < minScore) reasons.push('AIスコア不足');
  if (p.grossMarginPercent == null || p.grossMarginPercent < minMargin) reasons.push('粗利率不足');
  if (p.highComplaintRisk === true || p.restricted === true) reasons.push('安全性リスク');
  return { recommended: reasons.length === 0, reasons };
}
export function supplierListingEligibility(p) {
  const reasons = [];
  if (p.stockStatus !== 'in_stock') reasons.push('在庫未確認または在庫0');
  if (!p.japanShippingVerified) reasons.push('日本配送未確認');
  if (p.shippingJpy == null) reasons.push('送料未確定');
  if (p.highComplaintRisk === true || p.restricted === true) reasons.push('安全性リスク');
  return { canList: reasons.length === 0, reasons, draftOnly: true };
}
export function groupEquivalentProducts(products) {
  const groups = new Map();
  for (const p of products) {
    const key = asText(p.globalTradeItemNumber || p.gtin || p.ean || p.upc) ||
      (asText(p.brand).toLowerCase() + '|' + asText(p.manufacturerPartNumber).toLowerCase());
    const reliable = Boolean(asText(p.globalTradeItemNumber || p.gtin || p.ean || p.upc) ||
      (asText(p.brand) && asText(p.manufacturerPartNumber)));
    const groupKey = reliable ? key : p.source + ':' + p.supplierId;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(p);
  }
  return [...groups.values()];
}

export function isActiveSupplier(source){ return ACTIVE_SUPPLIERS.includes(source); }
export function activeSupplierLabels(){ return ACTIVE_SUPPLIERS.map(k=>SUPPLIERS[k].label); }
