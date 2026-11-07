// Preview is connected to its own Vercel Marketplace database. Never fall back
// to inherited Production UPSTASH credentials, and never mix URL/token families.
export function redisConnection(env=process.env){
  const preview=env.VERCEL_ENV==='preview';
  const url=String((preview?env.KV_REST_API_URL:env.UPSTASH_REDIS_REST_URL)||'').trim().replace(/\/$/,'');
  const token=String((preview?env.KV_REST_API_TOKEN:env.UPSTASH_REDIS_REST_TOKEN)||'').trim();
  try{
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||!token)return {url:'',token:''};
  }catch{return {url:'',token:''};}
  return {url,token};
}
