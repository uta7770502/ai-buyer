// ADPS Shopify translation sync: dry-run by default, no product publication.
// Inject Shopify GraphQL client and translator; no credentials are stored here.
import { generateEnglishDraft } from './product-translation-orchestrator.js';
import { buildProductTranslationRegistration } from './shopify-translation-registration.js';

export const TRANSLATABLE_PRODUCT_QUERY = `query ADPSProductTranslationDigests($resourceId: ID!) {
  translatableResource(resourceId: $resourceId) {
    resourceId
    translatableContent { key value digest locale }
  }
}`;

function unwrap(response) {
  if (response?.errors?.length) throw new Error('Shopify GraphQL errors: ' + response.errors.map(e=>e.message).join('; '));
  return response?.data ?? response;
}

export async function syncEnglishProductDraft({product, translator, shopifyGraphql, approved = false, apply = false} = {}) {
  if (typeof shopifyGraphql !== 'function') throw new TypeError('Shopify GraphQL client required');
  // Generate and validate translation before accessing Shopify.
  const draft = await generateEnglishDraft(product, translator);
  const resource = unwrap(await shopifyGraphql(TRANSLATABLE_PRODUCT_QUERY, {resourceId:draft.productId}))?.translatableResource;
  if (!resource || resource.resourceId !== draft.productId || !Array.isArray(resource.translatableContent)) {
    throw new Error('Shopify translatableResource mismatch or missing');
  }
  const resources = resource.translatableContent
    .filter(x=>x?.key==='title' || x?.key==='body_html')
    .map(x=>({key:x.key,digest:x.digest}));
  // Explicit approval is required even for dry-run payload construction.
  const payload = buildProductTranslationRegistration(draft, resources, {approved});
  if (!apply) return {mode:'dry-run',registered:false,productId:draft.productId,translationCount:payload.variables.translations.length};
  // Separate execution gate prevents accidental writes from callers.
  if (process.env.ADPS_ENGLISH_TRANSLATIONS_WRITE_ENABLED !== 'true') {
    throw new Error('English translation writes are disabled');
  }
  const result = unwrap(await shopifyGraphql(payload.query,payload.variables))?.translationsRegister;
  if (!result || (result.userErrors?.length ?? 0)>0) {
    throw new Error('Shopify translation registration failed: '+(result?.userErrors??[]).map(e=>e.message).join('; '));
  }
  return {mode:'apply',registered:true,productId:draft.productId,translationCount:payload.variables.translations.length};
}
