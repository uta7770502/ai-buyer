const BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
let cached = '', until = 0;

async function accessToken() {
  if (process.env.CJ_ACCESS_TOKEN) return process.env.CJ_ACCESS_TOKEN;
  if (cached && Date.now() < until) return cached;
  if (!process.env.CJ_API_KEY) throw Error('CJ_API_KEY is not configured');
  const response = await fetch(BASE + '/authentication/getAccessToken', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({apiKey:process.env.CJ_API_KEY})
  });
  const data = await response.json();
  if (!response.ok || data.result !== true || !data.data?.accessToken) throw Error(data.message || 'CJ authentication failed');
  cached = data.data.accessToken;
  until = Date.now() + 12 * 60 * 60 * 1000;
  return cached;
}

function flattenProducts(payload) {
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
    if (!q) return res.status(400).json({ok:false,error:'Search term required'});

    const url = new URL(BASE + '/product/listV2');
    url.searchParams.set('keyWord', q);
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(size));
    url.searchParams.set('verifiedWarehouse', '1');
    url.searchParams.set('orderBy', '0');
    url.searchParams.set('sort', 'desc');
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
      name: p.nameEn || p.productNameEn || p.productName || 'CJ Product',
      image: p.bigImage || p.productImage || '',
      sellPrice: p.sellPrice || p.nowPrice || p.price || 0,
      listedNum: Number(p.listedNum || 0),
      category: p.threeCategoryName || p.categoryName || '',
      inventory: Number(p.warehouseInventoryNum ?? 0),
      verifiedInventory: Number(p.totalVerifiedInventory ?? 0),
      unverifiedInventory: Number(p.totalUnVerifiedInventory ?? 0),
      verifiedWarehouse: Number(p.verifiedWarehouse ?? 0),
      deliveryCycle: String(p.deliveryCycle || ''),
      saleStatus: String(p.saleStatus ?? ''),
      authorityStatus: String(p.authorityStatus ?? ''),
      supplierName: String(p.supplierName || ''),
      createAt: Number(p.createAt || 0)
    })).filter(p => p.id);

    const totalRecords = Number(payload.totalRecords || products.length);
    const totalPages = Number(payload.totalPages || Math.max(1,Math.ceil(totalRecords/size)));
    res.setHeader('Cache-Control','private, no-store');
    return res.status(200).json({ok:true,products,totalRecords,totalPages});
  } catch(error) {
    return res.status(500).json({ok:false,error:error.message || 'CJ search failed'});
  }
}
