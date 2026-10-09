const VERSION='2026-10';
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const c=cookies(req),token=String(c.shopify_access_token||''),shop=String(c.shopify_connected_shop||'');
    if(!token||!shop)return res.status(401).json({ok:false,authRequired:true,error:'Shopify認証が必要です'});
    const started=Date.now();
    const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query:'query { shop { name myshopifyDomain } }'})});
    const j=await r.json();
    if(!r.ok||j.errors?.length||!j.data?.shop)throw Error(j.errors?.[0]?.message||'Shopify接続に失敗しました');
    return res.status(200).json({ok:true,configured:true,shop:j.data.shop.name,domain:j.data.shop.myshopifyDomain,latencyMs:Date.now()-started,checkedAt:new Date().toISOString()});
  }catch(e){return res.status(401).json({ok:false,authRequired:true,error:e.message||'Shopify再認証が必要です'})}
}