const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

let tokenCache = { accessToken: null, expiresAt: 0 };

async function getAccessToken() {
  if (process.env.CJ_ACCESS_TOKEN) return process.env.CJ_ACCESS_TOKEN;
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) return tokenCache.accessToken;
  const apiKey = process.env.CJ_API_KEY;
  if (!apiKey) throw new Error('CJ_API_KEY is not configured');
  const response = await fetch(`${CJ_BASE}/authentication/getAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  const json = await response.json();
  if (!response.ok || !json?.result || !json?.data?.accessToken) {
    throw new Error(json?.message || 'Failed to get CJ access token');
  }
  tokenCache.accessToken = json.data.accessToken;
  tokenCache.expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  return tokenCache.accessToken;
}

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
    if (!id) return res.status(400).json({ error: 'Product id is required' });
    const token = await getAccessToken();
    const url = new URL(`${CJ_BASE}/product/query`);
    url.searchParams.set('pid', id);
    url.searchParams.append('features', 'enable_video');
    const response = await fetch(url, { headers: { 'CJ-Access-Token': token } });
    const json = await response.json();
    if (!response.ok || json?.result !== true) {
      return res.status(response.ok ? 502 : response.status).json({ error: json?.message || 'CJ product detail failed', code: json?.code });
    }
    const p = json.data || {};
    const variants = Array.isArray(p.variants) ? p.variants : Array.isArray(p.variantList) ? p.variantList : [];
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
        weight: pick(p, ['productWeight','weight'], ''),
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
    return res.status(500).json({ error: error.message || 'Server error' });
  }
}
