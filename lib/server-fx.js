// Server-only FX lookup. A failed or stale response must never become a verified rate.
export async function getUsdJpyRate({fetcher=fetch,now=Date.now()}={}){
 const fail=reason=>({verified:false,usdJpyRate:null,fxVerifiedAt:null,reason});
 try{
  const response=await fetcher('https://open.er-api.com/v6/latest/USD',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(6000)});
  if(!response.ok)return fail('為替データを取得できません');
  const data=await response.json();
  const rate=data?.rates?.JPY;
  const updated=Number(data?.time_last_update_unix);
  if(data?.result!=='success'||typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||rate>1000)return fail('為替データが不正です');
  if(!Number.isFinite(updated)||updated<=0||updated*1000>now||now-updated*1000>48*60*60*1000)return fail('為替データの更新日時が古いか不正です');
  return {verified:true,usdJpyRate:rate,fxVerifiedAt:new Date(now).toISOString(),fxSource:'open.er-api.com',fxSourceUpdatedAt:new Date(updated*1000).toISOString()};
 }catch{return fail('為替データの取得に失敗しました')}
}
