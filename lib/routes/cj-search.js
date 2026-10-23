const BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
let cached = '', until = 0;

async function accessToken() {
  // Prefer refreshing from CJ_API_KEY when available. A static CJ_ACCESS_TOKEN can expire
  // and must not permanently block product discovery.
  if (cached && Date.now() < until) return cached;
  if (process.env.CJ_API_KEY) {
    const response = await fetch(BASE + '/authentication/getAccessToken', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({apiKey:process.env.CJ_API_KEY})
    });
    const data = await response.json();
    if (!response.ok || data.result !== true || !data.data?.accessToken) throw Error(data.message || 'CJ authentication failed');
    cached = data.data.accessToken;
    // Refresh conservatively before CJ's server-side expiry.
    const expiresAt = Date.parse(data.data.accessTokenExpiryDate || data.data.accessTokenExpiry || '');
    until = Number.isFinite(expiresAt) ? Math.max(Date.now()+5*60*1000, expiresAt-10*60*1000) : Date.now()+12*60*60*1000;
    return cached;
  }
  if (process.env.CJ_ACCESS_TOKEN) return process.env.CJ_ACCESS_TOKEN;
  throw Error('CJ_API_KEY/CJ_ACCESS_TOKEN is not configured in this deployment. Redeploy after updating Vercel environment variables.');
}

function flattenProducts(payload) {
  // Current CJ Product List V2 returns products in data.list.
  if (Array.isArray(payload?.list)) return payload.list;
  // Keep compatibility with older/alternate payload shapes.
  const content = Array.isArray(payload?.content) ? payload.content : [];
  const out = [];
  for (const group of content) {
    if (Array.isArray(group?.productList)) out.push(...group.productList);
    else if (group && typeof group === 'object' && (group.id || group.pid)) out.push(group);
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'Method not allowed'});
  try {
    const q = String(req.query.q || '').trim().slice(0,100);
    const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1));
    const size = Math.min(50, Math.max(1,Number(req.query.size) || 20));
    const trending = String(req.query.trending || '') === '1';
    const minListed = Math.max(0, Math.min(100000, Number(req.query.minListed) || 0));
    if (!q) return res.status(400).json({ok:false,error:'Search term required'});

    const url = new URL(BASE + '/product/listV2');
    url.searchParams.set('keyWord', q);
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(size));
    // listV2 orderBy uses numeric values: 0 best match, 1 listing count, 2 price, 3 create time, 4 inventory.
    // ODDLY prioritizes proven demand, so sort by listing count rather than newest products.
    url.searchParams.set('orderBy', '1');
    url.searchParams.set('sort', 'desc');
    // listV2 uses productFlag=0 for Trending products. Older searchType/minListedNum belong to legacy search behavior.
    if (trending) url.searchParams.set('productFlag', '0');
    url.searchParams.append('features', 'enable_category');

    const response = await fetch(url, {headers:{'CJ-Access-Token':await accessToken()}});
    const data = await response.json();
    if (!response.ok || data.result !== true) {
      return res.status(response.ok ? 502 : response.status).json({ok:false,error:data.message || 'CJ search failed'});
    }

    const payload = data.data || {};
    const list = flattenProducts(payload);
    const products = list.map(p => ({
      id: p.id || p.pid || p.productId,
      sku: p.sku || p.productSku || '',
      name: p.nameEn || p.productNameEn || p.productName || p.name || 'CJ Product',
      image: p.bigImage || p.productImage || p.image || '',
      sellPrice: p.nowPrice || p.discountPrice || p.sellPrice || p.totalPrice || p.price || 0,
      listedNum: Number(p.listedNum ?? p.listedShopNum ?? 0),
      category: p.threeCategoryName || p.categoryName || '',
      categoryName: p.threeCategoryName || p.twoCategoryName || p.oneCategoryName || p.categoryName || '',
      inventory: p.warehouseInventoryNum == null ? null : Number(p.warehouseInventoryNum),
      verifiedInventory: p.totalVerifiedInventory == null ? null : Number(p.totalVerifiedInventory),
      unverifiedInventory: p.totalUnVerifiedInventory == null ? null : Number(p.totalUnVerifiedInventory),
      verifiedWarehouse: Number(p.verifiedWarehouse ?? 0),
      deliveryCycle: String(p.deliveryCycle || ''),
      saleStatus: String(p.saleStatus ?? ''),
      authorityStatus: String(p.authorityStatus ?? ''),
      supplierName: String(p.supplierName || ''),
      createAt: Number(p.createAt || 0),
      productType: String(p.productType ?? ''),
      trending
    })).filter(p => p.id);

    const filteredProducts = minListed > 0 ? products.filter(p => p.listedNum >= minListed) : products;
    const totalRecords = Number(payload.total ?? payload.totalRecords ?? filteredProducts.length);
    const pageSize = Number(payload.pageSize || size);
    const totalPages = Number(payload.totalPages || Math.max(1,Math.ceil(totalRecords/pageSize)));
    res.setHeader('Cache-Control','private, no-store');
    return res.status(200).json({ok:true,products:filteredProducts,totalRecords,totalPages,trending,minListed});
  } catch(error) {
    return res.status(500).json({ok:false,error:error.message || 'CJ search failed'});
  }
}

// CJ credential refresh deployment marker: 2026-10-23
