// ADPS draft pipeline integration hook. Never blocks the existing Japanese draft flow.
// English translation is opt-in, read-only by default and is never a publication gate.
import {createEnglishTranslationProvider} from './gemini-english-translation-provider.js';
import {syncEnglishProductDraft} from './shopify-english-draft-sync.js';
import {auditEnglishLocalizationCandidates} from './oddly-localization-catalog-audit.js';

export async function prepareEnglishForSavedDraft({product, shopifyGraphql, env = process.env, fetchImpl} = {}) {
  if (env.ADPS_ENGLISH_TRANSLATIONS_DRY_RUN_ENABLED !== 'true') {
    return {status:'disabled',adminLocale:'ja',registered:false};
  }
  if (!product || product.status !== 'DRAFT') {
    return {status:'skipped-non-draft',adminLocale:'ja',registered:false};
  }
  // Do not send unverified commercial or pet-suitability claims to the translator.
  // Shopify inventory is audited separately: a zero Shopify count is not proof of zero CJ stock.
  const audit=auditEnglishLocalizationCandidates([{id:product.id,status:product.status,title:product.title,description:product.descriptionHtml,shopifyInventory:1}]);
  if(audit.items[0].reasons.some(reason=>reason!=='shopify-inventory-not-positive')) {
    return {status:'source-review-required',adminLocale:'ja',registered:false,reasons:audit.items[0].reasons};
  }
  if (!env.GEMINI_API_KEY) {
    return {status:'missing-translation-credentials',adminLocale:'ja',registered:false};
  }
  try {
    const translator=createEnglishTranslationProvider({
      apiKey:env.GEMINI_API_KEY,
      model:env.ADPS_ENGLISH_TRANSLATION_MODEL || 'gemini-2.5-flash',
      ...(fetchImpl?{fetchImpl}:{})
    });
    const result=await syncEnglishProductDraft({
      product,translator,shopifyGraphql,approved:true,apply:false
    });
    return {status:'dry-run-ready',adminLocale:'ja',registered:false,translationCount:result.translationCount};
  } catch (error) {
    return {status:'review-required',adminLocale:'ja',registered:false,
      reason:String(error?.message || 'translation unavailable').slice(0,180)};
  }
}
