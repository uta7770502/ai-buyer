// ODDLY storefront localization policy. ADPS administration remains Japanese-only.
// This is a pure resolver; it does not activate Shopify Markets or alter the storefront.
export const ADPS_ADMIN_LOCALE = 'ja';
export const STOREFRONT_LOCALES = Object.freeze(['ja', 'en']);

const englishRegions = new Set(['US','AU','SG','GB','CA','NZ','IE']);
const normalize = value => String(value ?? '').trim().toUpperCase();

export function resolveOddlyStorefrontLocale({countryCode, selectedLocale, supportedLocales = STOREFRONT_LOCALES} = {}) {
  const supported = new Set(supportedLocales);
  if (!supported.has('ja')) throw new Error('Japanese storefront locale must be supported');
  if (selectedLocale != null && selectedLocale !== '') {
    if (!supported.has(selectedLocale)) throw new Error('Selected storefront locale is not supported');
    return Object.freeze({locale:selectedLocale, reason:'customer-selection', adminLocale:ADPS_ADMIN_LOCALE});
  }
  const country = normalize(countryCode);
  const locale = englishRegions.has(country) && supported.has('en') ? 'en' : 'ja';
  return Object.freeze({locale,reason:country ? 'region-preference' : 'default',adminLocale:ADPS_ADMIN_LOCALE});
}

export function verifyStorefrontLocalizationReadiness({publishedLocales, activeMarkets, translatedContentReady} = {}) {
  const locales = new Set(publishedLocales ?? []);
  const markets = new Set(activeMarkets ?? []);
  const issues = [];
  if (!locales.has('ja')) issues.push('Japanese storefront locale is unavailable');
  if (!locales.has('en')) issues.push('English storefront locale is not published');
  if (!translatedContentReady) issues.push('English storefront content has not passed review');
  if (!['US','AU','SG'].some(country => markets.has(country))) issues.push('No target overseas market is active');
  return Object.freeze({ready:issues.length===0,issues,adminLocale:ADPS_ADMIN_LOCALE});
}
