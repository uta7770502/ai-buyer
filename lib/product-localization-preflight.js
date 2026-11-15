// ADPS Japanese/English product localization preparation.
// Deliberately read-only: never registers translations or publishes locales.
const LOCALES = Object.freeze(['ja', 'en']);
const PRODUCT_KEYS = Object.freeze(['title', 'body_html', 'handle', 'seo_title', 'seo_description']);
const clean = value => String(value ?? '').trim();
const validLocale = value => LOCALES.includes(value);
const normalized = value => clean(value).normalize('NFKC');

export function prepareProductTranslations(product, translated, options = {}) {
  if (!product || !translated || typeof product !== 'object' || typeof translated !== 'object') {
    throw new TypeError('Product and translations are required');
  }
  const id = clean(product.id);
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(id)) throw new Error('Invalid Shopify product ID');
  if (product.status !== 'DRAFT') throw new Error('Only draft products may be prepared');
  const sourceLocale = clean(options.sourceLocale || 'ja');
  const targetLocale = clean(options.targetLocale || 'en');
  if (!validLocale(sourceLocale) || !validLocale(targetLocale) || sourceLocale === targetLocale) {
    throw new Error('Unsupported language pair');
  }
  const title = normalized(translated.title);
  const description = clean(translated.description);
  if (!title || !description) throw new Error('English title and description are required');
  const claims = [translated.shippingClaims, translated.returnClaims, translated.safetyClaims];
  if (claims.some(value => value && options.claimsVerified !== true)) {
    throw new Error('Shipping, returns and safety claims require verification');
  }
  const source = { title: clean(product.title), body_html: clean(product.descriptionHtml) };
  if (!source.title || !source.body_html) throw new Error('Source product content missing');
  return Object.freeze({
    productId: id,
    sourceLocale,
    targetLocale,
    source,
    proposed: Object.freeze({ title, body_html: description }),
    needsShopifyTranslationDigest: true,
    requiresHumanLegalReview: true,
    publishAllowed: false,
    registrationPerformed: false
  });
}

export function validateShopifyTranslationDigests(resources) {
  if (!Array.isArray(resources) || resources.length === 0) throw new Error('Shopify translatable resources missing');
  return resources.map(item => {
    const key = clean(item.key);
    const digest = clean(item.digest);
    if (!PRODUCT_KEYS.includes(key) || !digest) throw new Error('Missing or unsupported translation digest');
    return { key, digest };
  });
}
