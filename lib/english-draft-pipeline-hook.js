// ADPS draft pipeline integration hook. Never blocks the existing Japanese draft flow.
// English translation is opt-in, read-only by default and is never a publication gate.
import {createEnglishTranslationProvider} from './gemini-english-translation-provider.js';
import {syncEnglishProductDraft} from './shopify-english-draft-sync.js';
import {auditEnglishLocalizationCandidates} from './oddly-localization-catalog-audit.js';
import {prepareFactualTranslationSource} from './oddly-factual-translation-source.js';

export async function prepareEnglishForSavedDraft({product, shopifyGraphql, env = process.env, fetchImpl} = {}) {
  if (env.ADPS_ENGLISH_TRANSLATIONS_DRY_RUN_ENABLED !== 'true') {
    return {status:'disabled',adminLocale:'ja',registered:false};
  }
  if (!product || product.status !== 'DRAFT') {
    return {status:'skipped-non-draft',adminLocale:'ja',registered:false};
  }
  // Strip only recognized commercial boilerplate. Unknown claims remain blocked.
  let factual;
  try {
    factual=prepareFactualTranslationSource({title:product.title,description:product.descriptionHtml});
  } catch {
    return {status:'source-review-required',adminLocale:'ja',registered:false,reasons:['invalid-source-copy']};
  }
  if(!factual.readyForTranslation){
    return {status:'source-review-required',adminLocale:'ja',registered:false,reasons:factual.reviewReasons};
  }
  const audit=auditEnglishLocalizationCandidates([{
    id:product.id,status:product.status,title:factual.title,
    description:factual.description,shopifyInventory:1
  }]);
  if(audit.items[0].reasons.length){
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
      product:{...product,title:factual.title,descriptionHtml:factual.description},
      translator,shopifyGraphql,approved:true,apply:false
    });
    return {status:'dry-run-ready',adminLocale:'ja',registered:false,translationCount:result.translationCount};
  } catch (error) {
    return {status:'review-required',adminLocale:'ja',registered:false,
      reason:String(error?.message || 'translation unavailable').slice(0,180)};
  }
}
