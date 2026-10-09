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

function firstNumber(v) {
  const m = String(v ?? '').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function pick(obj, keys, fallback = '') {
  for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  return fallback;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchOne(id, token) {
  const detailUrl = new URL(`${CJ_BASE}/product/query`);
  detailUrl.searchParams.set('pid', id);
  const inventoryUrl = new URL(`${CJ_BASE}/product/stock/getInventoryByPid`);
  inventoryUrl.searchParams.set('pid', id);

  const detailRes = await fetch(detailUrl, { headers: { 'CJ-Access-Token': token } });
  const detailJson = await detailRes.json();
  await pause(1200);
  const inventoryRes = await fetch(inventoryUrl, { headers: { 'CJ-Access-Token': token } });
  const inventoryJson = await inventoryRes.json();

  if (!detailRes.ok || detailJson?.result !== true) {
    throw new Error(detailJson?.message || `Product detail failed: ${id}`);
  }

  const p = detailJson.data || {};
  if (!inventoryRes.ok || (inventoryJson?.result !== true && inventoryJson?.success !== true) || !Array.isArray(inventoryJson?.data?.inventories)) {
    throw new Error(inventoryJson?.message || 'CJ在庫情報を確認できません');
  }
  const inventories = inventoryJson.data.inventories;
  const stockTotal = inventories.reduce((s, x) => s + Number(x?.totalInventoryNum || 0), 0);
  const cjInventory = inventories.reduce((s, x) => s + Number(x?.cjInventoryNum || 0), 0);
  const factoryInventory = inventories.reduce((s, x) => s + Number(x?.factoryInventoryNum || 0), 0);

  return {
    id,
    sku: pick(p, ['productSku', 'sku'], ''),
    name: pick(p, ['productNameEn', 'nameEn', 'productName', 'name'], 'CJ Product'),
    sellPrice: firstNumber(pick(p, ['sellPrice', 'price'], 0)),
    saleStatus: pick(p, ['saleStatus', 'status'], null),
    stockTotal,
    cjInventory,
    factoryInventory,
    warehouses: inventories.map(x => ({
      countryCode: x?.countryCode || '',
      name: x?.areaEn || x?.countryNameEn || '',
      total: Number(x?.totalInventoryNum || 0),
      cj: Number(x?.cjInventoryNum || 0),
      factory: Number(x?.factoryInventoryNum || 0),
    })),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (!ids.length) return res.status(400).json({ error: 'ids is required' });
    const token = await getAccessToken();
    const settled = [];
    for (const id of ids) {
      await pause(1200);
      try { settled.push({ status: 'fulfilled', value: await fetchOne(id, token) }); }
      catch (reason) { settled.push({ status: 'rejected', reason }); }
    }
    const products = [];
    const errors = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') products.push(r.value);
      else errors.push({ id: ids[i], error: r.reason?.message || 'Unknown error' });
    });
    return res.status(200).json({ ok: true, checkedAt: new Date().toISOString(), products, errors });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
}
