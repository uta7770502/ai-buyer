import { getCJAccessToken } from '../cj-access-token.js';
const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
const CJ_DETAIL_TIMEOUT_MS=10000;

function pick(obj, keys, fallback = '') {
  for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  return fallback;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const id = String(req.query.id || '').trim();
    if (!/^[a-zA-Z0-9:-]{1,100}$/.test(id)) return res.status(400).json({ error: 'Invalid product id' });
    const token = await getCJAccessToken();
    const url = new URL(`${CJ_BASE}/product/query`);
    url.searchParams.set('pid', id);
    // Retry only transient upstream failures, within one total request budget.
    const deadline = Date.now() + CJ_DETAIL_TIMEOUT_MS;
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Object.assign(new Error('CJ detail deadline exceeded'), { name: 'TimeoutError' });
      response = await fetch(url, { headers: { 'CJ-Access-Token': token }, signal: AbortSignal.timeout(Math.min(remaining, CJ_DETAIL_TIMEOUT_MS)) });
      if (![500, 502, 503, 504].includes(response.status) || attempt === 1) break;
      // Release the failed response before retrying; never expose upstream bodies.
      await response.body?.cancel();
      const retryRemaining = deadline - Date.now();
      if (retryRemaining <= 150) throw Object.assign(new Error('CJ detail deadline exceeded'), { name: 'TimeoutError' });
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.result !== true) {
      const authRejected = response.status === 401 || response.status === 403;
      res.setHeader('Cache-Control', 'no-store');
      return res.status(authRejected ? 503 : 502).json({ error: 'CJ商品詳細を取得できませんでした。', code: authRejected ? 'CJ_DETAIL_AUTH_REJECTED' : !response.ok ? 'CJ_DETAIL_HTTP_ERROR' : !json ? 'CJ_DETAIL_INVALID_JSON' : 'CJ_DETAIL_UPSTREAM_REJECTED', upstreamStatus: response.status });
    }
    const p = json.data;
    if(!p || typeof p !== 'object' || Array.isArray(p) || String(pick(p,['pid','id','productId'],'')) !== id){
      return res.status(502).json({error:'CJ商品IDと詳細情報が一致しません。販売を保留します。',code:'CJ_DETAIL_ID_MISMATCH'});
    }
    const variants = Array.isArray(p.variants) ? p.variants : Array.isArray(p.variantList) ? p.variantList : [];
    // A catalog price is a supplier quote, never a settled purchase cost.
    // Currency must be explicitly declared by CJ, not assumed from a number.
    const quoteEvidence = variants.slice(0,50).map(v=>{
      const vid=String(pick(v,['vid','id','variantId'],''));
      const raw=pick(v,['variantSellPrice','sellPrice','price'],null);
      const currency=String(pick(v,['currency','currencyCode','priceCurrency'],'')).trim().toUpperCase();
      const numeric=typeof raw==='number'||typeof raw==='string'?String(raw).trim():'';
      const valid=/^\d+(?:\.\d+)?$/.test(numeric)&&Number.isFinite(Number(numeric))&&Number(numeric)>0;
      return {vid,source:'cj-selected-variant-quote',currency:currency||null,quotedAmount:valid?Number(numeric):null,quoteCurrencyVerified:currency==='USD'&&valid,settledCostVerified:false,finalProfitVerified:false};
    });
    const imagesRaw = pick(p, ['productImageSet','images','imageList'], []);
    const images = Array.isArray(imagesRaw) ? imagesRaw : String(imagesRaw || '').split(',').filter(Boolean);
    return res.status(200).json({
      ok: true,
      product: {
        id: pick(p, ['pid','id','productId'], id),
        sku: pick(p, ['productSku','sku'], ''),
        name: pick(p, ['productNameEn','nameEn','productName','name'], 'CJ Product'),
        image: pick(p, ['bigImage','productImage','image'], images[0] || ''),
        images,
        description: pick(p, ['description','productDescription','descriptionEn'], ''),
        category: pick(p, ['categoryName','categoryNameEn'], ''),
        sellPrice: pick(p, ['sellPrice','price'], ''),
        listedNum: pick(p, ['listedNum'], null),
        weight: pick(p, ['productWeight','weight'], ''),
        quoteEvidence,
        settledSupplierCostVerified:false,
        finalProfitVerified:false,
        variants: variants.slice(0, 50).map(v => ({
          id: pick(v, ['vid','id','variantId'], ''),
          sku: pick(v, ['variantSku','sku'], ''),
          name: pick(v, ['variantNameEn','variantName','name'], ''),
          price: pick(v, ['variantSellPrice','sellPrice','price'], ''),
          image: pick(v, ['variantImage','image'], ''),
        })),
      },
    });
  } catch (error) {
    const authFailed = error?.authFailure === true;
    const code=authFailed?'CJ_DETAIL_AUTH_FAILED':/CJ_API_KEY is not configured/.test(String(error?.message||''))?'CJ_AUTH_CONFIG_MISSING':error?.name==='TimeoutError'||error?.name==='AbortError'?'CJ_DETAIL_TIMEOUT':'CJ_DETAIL_FETCH_FAILED';
    res.setHeader('Cache-Control','no-store');
    const upstream = authFailed ? { upstreamStatus: error.upstreamStatus } : {};
    return res.status(503).json({ error: 'CJ商品情報を取得できませんでした。販売を保留します。',code,...upstream });
  }
}
