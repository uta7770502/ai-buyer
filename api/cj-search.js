const BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
let cached = '', until = 0;
async function accessToken() {
  if (process.env.CJ_ACCESS_TOKEN) return process.env.CJ_ACCESS_TOKEN;
  if (cached && Date.now() < until) return cached;
  if (!process.env.CJ_API_KEY) throw Error('CJ_API_KEY is not configured');
  const response = await fetch(BASE + '/authentication/getAccessToken', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({apiKey:process.env.CJ_API_KEY})
  });
  const data = await response.json();
  if (!response.ok || data.result !== true || !data.data?.accessToken) throw Error(data.message || 'CJ authentication failed');
  cached = data.data.accessToken;
  until = Date.now() + 12 * 60 * 60 * 1000;
  return cached;
}
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'Method not allowed'});
  try {
    const q = String(req.query.q || '').trim().slice(0,100);
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(50, Math.max(1,Number(req.query.size) || 20));
    if (!q) return res.status(400).json({ok:false,error:'Search term required'});
    const url = new URL(BASE + '/product/list');
    url.searchParams.set('productNameEn',q);
    url.searchParams.set('pageNum',String(page));
    url.searchParams.set('pageSize',String(size));
    const response = await fetch(url, {headers:{'CJ-Access-Token':await accessToken()}});
    const data = await response.json();
    if (!response.ok || data.result !== true) return res.status(502).json({ok:false,error:data.message || 'CJ search failed'});
    const payload = data.data || {};
    const list = Array.isArray(payload) ? payload : (payload.list || payload.content || []);
    const products = (Array.isArray(list) ? list : []).map(p => ({
      id:p.pid || p.id, sku:p.productSku || p.sku || '',
      name:p.productNameEn || p.productName || 'CJ Product',
      image:p.productImage || p.bigImage || '',
      sellPrice:p.sellPrice || p.price || 0,
      listedNum:Number(p.listedNum || 0),
      category:p.categoryName || ''
    }));
    const totalRecords = Number(payload.total || payload.totalRecords || products.length);
    return res.status(200).json({ok:true,products,totalRecords,totalPages:Math.max(1,Math.ceil(totalRecords/size))});
  } catch(error) {
    return res.status(500).json({ok:false,error:error.message || 'CJ search failed'});
  }
}
