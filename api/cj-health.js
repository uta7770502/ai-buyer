const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

let tokenCache={token:'',expiresAt:0,mode:''};
let healthCache={ok:false,mode:'',latencyMs:0,checkedAt:'',expiresAt:0};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function resolveToken() {
  if (process.env.CJ_ACCESS_TOKEN) return { token: process.env.CJ_ACCESS_TOKEN, mode: 'access-token' };
  if(tokenCache.token&&Date.now()<tokenCache.expiresAt-60000)return {token:tokenCache.token,mode:tokenCache.mode||'api-key'};
  const apiKey = process.env.CJ_API_KEY;
  if (!apiKey) throw new Error('CJ_API_KEY / CJ_ACCESS_TOKEN is not configured');
  const response = await fetch(CJ_BASE+'/authentication/getAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  const json = await response.json();
  if (!response.ok || !json?.result || !json?.data?.accessToken) throw new Error(json?.message || 'CJ authentication failed');
  tokenCache={token:json.data.accessToken,expiresAt:Date.now()+12*60*60*1000,mode:'api-key'};
  return { token: tokenCache.token, mode: tokenCache.mode };
}

async function categoryCheck(token){
  for(let attempt=0;attempt<2;attempt++){
    const response=await fetch(CJ_BASE+'/product/getCategory',{headers:{'CJ-Access-Token':token}});
    const json=await response.json();
    if(response.ok&&json?.result===true)return true;
    const msg=String(json?.message||'CJ category test failed');
    if(/too many requests|qps/i.test(msg)&&attempt===0){await sleep(1100);continue}
    throw new Error(msg);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if(healthCache.ok&&Date.now()<healthCache.expiresAt){
    return res.status(200).json({ok:true,mode:healthCache.mode,latencyMs:healthCache.latencyMs,checkedAt:healthCache.checkedAt,cached:true});
  }
  const started = Date.now();
  try {
    const { token, mode } = await resolveToken();
    await sleep(1050);
    await categoryCheck(token);
    const out={ok:true,mode,latencyMs:Date.now()-started,checkedAt:new Date().toISOString()};
    healthCache={...out,expiresAt:Date.now()+60*1000};
    return res.status(200).json(out);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'CJ health check failed', latencyMs: Date.now() - started, checkedAt: new Date().toISOString() });
  }
}