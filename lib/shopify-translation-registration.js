// Build Shopify translationsRegister inputs without performing any network writes.
// Callers must fetch current translatableResource digests from Shopify first.
// This module does not activate locales, markets, products or checkout.
const text = v => typeof v === 'string' ? v.trim() : '';
const allowed = new Set(['title', 'body_html']);
const validDigest = v => typeof v === 'string' && v.length > 0;
export const SHOPIFY_TRANSLATIONS_REGISTER = `mutation ADPSRegisterTranslations($resourceId: ID!, $translations: [TranslationInput!]!) {
  translationsRegister(resourceId: $resourceId, translations: $translations) {
    userErrors { field message }
    translations { key locale value }
  }
}`;

export function buildProductTranslationRegistration(preflight, resources, options = {}) {
  if (!preflight || preflight.registrationPerformed !== false || preflight.publishAllowed !== false ||
      preflight.requiresHumanLegalReview !== true || preflight.needsShopifyTranslationDigest !== true) {
    throw new Error('A safe translation preflight is required');
  }
  if (preflight.sourceLocale !== 'ja' || preflight.targetLocale !== 'en') {
    throw new Error('Only Japanese-to-English is supported');
  }
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(preflight.productId)) {
    throw new Error('Invalid Shopify product ID');
  }
  if (!Array.isArray(resources)) throw new Error('Current Shopify digests are required');
  const byKey = new Map();
  for (const item of resources) {
    if (!item || !allowed.has(item.key) || !validDigest(item.digest) || byKey.has(item.key)) {
      throw new Error('Invalid, duplicate, or unsupported Shopify digest');
    }
    byKey.set(item.key, item.digest);
  }
  const title = text(preflight.proposed?.title);
  const body = text(preflight.proposed?.body_html);
  if (!title || !body || !byKey.has('title') || !byKey.has('body_html')) {
    throw new Error('Missing translation or Shopify digest');
  }
  // Opt-in only: legal review and human approval must happen outside this builder.
  if (options.approved !== true) throw new Error('Explicit translation registration approval required');
  return Object.freeze({
    query: SHOPIFY_TRANSLATIONS_REGISTER,
    variables: {
      resourceId: preflight.productId,
      translations: [
        {locale:'en', key:'title', value:title, translatableContentDigest:byKey.get('title')},
        {locale:'en', key:'body_html', value:body, translatableContentDigest:byKey.get('body_html')}
      ]
    },
    executed: false,
    publishAllowed: false
  });
}
