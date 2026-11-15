// ADPS draft pipeline integration hook. Never blocks the existing Japanese draft flow.
// English translation is opt-in, read-only by default and is never a publication gate.
import {createEnglishTranslationProvider} from './gemini-english-translation-provider.js';
import {syncEnglishProductDraft} from './shopify-english-draft-sync.js';

export async function prepareEnglishForSavedDraft({product, shopifyGraphql, env = process.env, fetchImpl} = {}) {
  if (env.ADPS_ENGLISH_TRANSLATIONS_DRY_RUN_ENABLED !== 'true') {
    return {status:'disabled',adminLocale:'ja',registered:false};
  }
  if (!product || product.status !== 'DRAFT') {
    return {status:'skipped-non-draft',adminLocale:'ja',registered:false};
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
