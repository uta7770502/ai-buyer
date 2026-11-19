const TOKEN_URL = 'https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken';
let cachedToken;
let pendingToken;

async function requestToken(apiKey) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json().catch(() => null);
  const value = body?.data?.accessToken;
  if (!response.ok || body?.result !== true || typeof value !== 'string' || !value.trim()) {
    const error = new Error('CJ authentication failed');
    error.authFailure = true;
    error.upstreamStatus = response.status;
    throw error;
  }
  const expiry = Date.parse(body.data.accessTokenExpiryDate || body.data.accessTokenExpiry || '');
  cachedToken = { value, until: Number.isFinite(expiry) ? expiry - 600000 : Date.now() + 1800000 };
  return value;
}

export async function getCJAccessToken() {
  const apiKey = process.env.CJ_API_KEY;
  if (!apiKey) {
    if (process.env.CJ_ACCESS_TOKEN) return process.env.CJ_ACCESS_TOKEN;
    throw new Error('CJ_API_KEY is not configured');
  }
  if (cachedToken && Date.now() < cachedToken.until) return cachedToken.value;
  pendingToken ??= requestToken(apiKey).finally(() => { pendingToken = undefined; });
  return pendingToken;
}
