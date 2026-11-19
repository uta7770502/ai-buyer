// Provider adapter for ADPS product translations.
// Inject fetch and credentials from server-side configuration only.
// No API call is made until the returned provider is invoked.
const requireText = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(name + ' is required');
  return value.trim();
};

export function createEnglishTranslationProvider({apiKey, model = 'gemini-2.5-flash', fetchImpl = globalThis.fetch, endpoint = 'https://generativelanguage.googleapis.com/v1beta'} = {}) {
  requireText(apiKey, 'Translation API key');
  requireText(model, 'Translation model');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation required');
  if (!/^https:\/\//.test(endpoint)) throw new Error('HTTPS endpoint required');
  return async function translate(request) {
    if (request?.sourceLocale !== 'ja' || request?.targetLocale !== 'en' ||
        !request?.input?.title || !request?.input?.description || !Array.isArray(request.instructions)) {
      throw new Error('Invalid Japanese-to-English translation request');
    }
    const url = endpoint.replace(/\/$/, '') + '/models/' + encodeURIComponent(model) + ':generateContent';
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{role:'user',parts:[{text:JSON.stringify({
          task:'Translate Shopify product information from Japanese to English',
          rules:request.instructions,
          input:request.input
        })}]}],
        generationConfig: {responseMimeType:'application/json',temperature:0.1}
      })
    });
    if (!response?.ok) throw new Error('Translation provider HTTP error: ' + (response?.status ?? 'unknown'));
    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.map(p=>p.text ?? '').join('') ?? '';
    let translated;
    try { translated = JSON.parse(raw); } catch { throw new Error('Translation provider returned invalid JSON'); }
    if (typeof translated?.title !== 'string' || typeof translated?.description !== 'string' ||
        !translated.title.trim() || !translated.description.trim()) {
      throw new Error('Translation provider returned incomplete fields');
    }
    return {title:translated.title.trim(),description:translated.description.trim()};
  };
}
