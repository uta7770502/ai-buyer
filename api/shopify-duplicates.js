const VERSION='2026-10';
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(10000)});
  const j=await r.json();if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify API request failed');return j.data;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const c=cookies(req),token=String(c.shopify_access_token||''),shop=String(c.shopify_connected_shop||'').toLowerCase();
    if(!token||!shop)return res.status(401).json({ok:false,authRequired:true,error:'Shopify認証が必要です'});
    const allowed=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
    if(shop!==allowed)return res.status(403).json({ok:false,error:'Shopify shop is not authorized'});
    const d=await gql(shop,token,'query { products(first:100, query:"status:draft vendor:\"AI BUYER\"") { nodes { id title handle status vendor variants(first:10){nodes{id sku}} } } }');
    const rows=d.products?.nodes||[];
    const byKey=new Map();
    for(const p of rows){
      const skus=(p.variants?.nodes||[]).map(v=>String(v.sku||'').trim()).filter(Boolean);
      const keys=skus.length?skus.map(s=>'sku:'+s):['title:'+String(p.title||'').trim().toLowerCase()];
      for(const key of keys){if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push({id:p.id,title:p.title,handle:p.handle,sku:key.startsWith('sku:')?key.slice(4):''});}
    }
    const groups=[...byKey.entries()].filter(([,arr])=>arr.length>1).map(([key,items])=>({key,count:items.length,items}));
    return res.status(200).json({ok:true,totalDrafts:rows.length,duplicateGroups:groups.length,groups});
  }catch(e){return res.status(500).json({ok:false,error:e.message||'重複チェックに失敗しました'})}
}