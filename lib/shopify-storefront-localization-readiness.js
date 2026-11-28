// Shopify storefront localization readiness query. Read-only; never activates locales or markets.
// Actual locale redirects are controlled by Shopify's published locales, Markets and theme.
export const STOREFRONT_LOCALIZATION_QUERY = `query ADPSStorefrontLocalizationReadiness {
  shopLocales { locale primary published }
  markets(first: 50) {
    nodes { id name enabled regions(first: 50) { nodes { ... on MarketRegionCountry { code } } } }
  }
}`;

export function summarizeShopifyLocalization(data) {
  if (!data || !Array.isArray(data.shopLocales) || !Array.isArray(data.markets?.nodes)) {
    throw new Error('Shopify locale and market data required');
  }
  const publishedLocales = [...new Set(data.shopLocales.filter(x => x?.published).map(x => x.locale))];
  const activeMarkets = [...new Set(data.markets.nodes.filter(x => x?.enabled).flatMap(m =>
    (m.regions?.nodes ?? []).map(region => region?.code).filter(Boolean)))];
  return Object.freeze({publishedLocales,activeMarkets,adminLocale:'ja',readOnly:true});
}

export function storefrontLanguageActionPlan(summary, translatedContentReady = false) {
  if (!summary || summary.readOnly !== true) throw new Error('Read-only Shopify summary required');
  const missing = [];
  if (!summary.publishedLocales.includes('en')) missing.push('Publish English as a Shopify storefront language after translations are reviewed');
  if (!translatedContentReady) missing.push('Review translated products, theme strings, menus and policies');
  if (!['US','AU','SG'].some(x => summary.activeMarkets.includes(x))) missing.push('Review and activate a supported overseas Shopify Market separately');
  return Object.freeze({adminLocale:'ja',canEnableEnglishExperience:missing.length===0,missing,changesApplied:false});
}
