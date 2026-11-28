// Pure translation orchestration. The caller supplies a translation provider.
// No Shopify writes, publication, market activation or external calls here.
import { prepareProductTranslations } from './product-localization-preflight.js';

const required = value => typeof value === 'string' && value.trim().length > 0;
const normalize = value => String(value ?? '').trim();

export function sourceFingerprint(product) {
  if (!product || !required(product.title) || !required(product.descriptionHtml)) {
    throw new Error('Source title and description are required');
  }
  // Deterministic content signature for change detection (not a security hash).
  return JSON.stringify([normalize(product.title), normalize(product.descriptionHtml)]);
}

export function needsTranslationRefresh(product, previousFingerprint) {
  return sourceFingerprint(product) !== previousFingerprint;
}

export function buildEnglishTranslationRequest(product) {
  const fingerprint = sourceFingerprint(product);
  if (product.status !== 'DRAFT' || !/^gid:\/\/shopify\/Product\/\d+$/.test(String(product.id ?? ''))) {
    throw new Error('Only valid Shopify draft products can be translated');
  }
  return Object.freeze({
    productId: product.id,
    sourceFingerprint: fingerprint,
    sourceLocale: 'ja',
    targetLocale: 'en',
    instructions: [
      'Translate product information into natural English without inventing features, certifications or claims.',
      'Preserve material, size, compatibility and safety warnings exactly when provided.',
      'Do not invent shipping speed, stock, return rights or warranties.',
      'Return a JSON object containing only title and description.'
    ],
    input: { title: normalize(product.title), description: normalize(product.descriptionHtml) }
  });
}

export async function generateEnglishDraft(product, provider, options = {}) {
  if (typeof provider !== 'function') throw new TypeError('Translation provider function required');
  const request = buildEnglishTranslationRequest(product);
  const result = await provider(request);
  if (!result || !required(result.title) || !required(result.description)) {
    throw new Error('Translation provider returned incomplete output');
  }
  if (sourceFingerprint(product) !== request.sourceFingerprint) {
    throw new Error('Product changed during translation; retry with current content');
  }
  const preflight = prepareProductTranslations(product, result, options);
  return Object.freeze({ ...preflight, sourceFingerprint: request.sourceFingerprint, translationGenerated: true });
}
