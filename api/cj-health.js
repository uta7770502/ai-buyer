const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

async function resolveToken() {
  if (process.env.CJ_ACCESS_TOKEN) return { token: process.env.CJ_ACCESS_TOKEN, mode: 'access-token' };
  const apiKey = process.env.CJ_API_KEY;
  if (!apiKey) throw new Error('CJ_API_KEY / CJ_ACCESS_TOKEN is not configured');
  const response = await fetch(`${CJ_BASE}/authentication/getAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  const json = await response.json();
  if (!response.ok || !json?.result || !json?.data?.accessToken) throw new Error(json?.message || 'CJ authentication failed');
  return { token: json.data.accessToken, mode: 'api-key' };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const started = Date.now();
  try {
    const { token, mode } = await resolveToken();
    const response = await fetch(`${CJ_BASE}/product/getCategory`, { headers: { 'CJ-Access-Token': token } });
    const json = await response.json();
    if (!response.ok || json?.result !== true) throw new Error(json?.message || 'CJ category test failed');
    return res.status(200).json({ ok: true, mode, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'CJ health check failed', latencyMs: Date.now() - started, checkedAt: new Date().toISOString() });
  }
}
