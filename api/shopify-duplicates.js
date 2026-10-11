const VERSION='2026-10';
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(10000)});
  const j=await r.json();if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify API request failed');return j.data;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const c=cookies(req),token=String(c.shopify_access_token||''),shop=String(c.shopify_connected_shop||'').toLowerCase();
    if(!token||!shop)return res.status(401).json({ok:false,authRequired:true,error:'Shopify認証が必要です'});
    const allowed=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
    if(shop!==allowed)return res.status(403).json({ok:false,error:'Shopify shop is not authorized'});
    const d=await gql(shop,token,'query DuplicateDrafts($q:String!){ products(first:100, query:$q) { nodes { id title handle status vendor variants(first:10){nodes{id sku}} } } }',{q:'status:draft vendor:AI BUYER'});
    const rows=d.products?.nodes||[];
    const byKey=new Map();
    for(const p of rows){
      const skus=(p.variants?.nodes||[]).map(v=>String(v.sku||'').trim()).filter(Boolean);
      const keys=skus.length?skus.map(s=>'sku:'+s):['title:'+String(p.title||'').trim().toLowerCase()];
      for(const key of keys){if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push({id:p.id,title:p.title,handle:p.handle,sku:key.startsWith('sku:')?key.slice(4):''});}
    }
    const groups=[...byKey.entries()].filter(([,arr])=>arr.length>1).map(([key,items])=>({key,count:items.length,items}));
    if(req.method==='POST'){
      const confirm=String(req.body?.confirm||'');
      if(confirm!=='REMOVE_DUPLICATE_DRAFTS')return res.status(400).json({ok:false,error:'確認コードが不正です'});
      const deleteIds=[];
      for(const g of groups){
        const items=[...g.items].sort((a,b)=>{
          const na=Number(String(a.id||'').split('/').pop())||0, nb=Number(String(b.id||'').split('/').pop())||0;
          return na-nb;
        });
        for(const item of items.slice(1))deleteIds.push(item.id);
      }
      const unique=[...new Set(deleteIds)];
      const deleted=[]; const errors=[];
      for(const id of unique){
        try{
          const d=await gql(shop,token,'mutation DeleteProduct($input:ProductDeleteInput!){ productDelete(input:$input){ deletedProductId userErrors{field message} } }',{input:{id}});
          const errs=d.productDelete?.userErrors||[];
          if(errs.length)errors.push({id,error:errs.map(e=>e.message).join(' / ')});
          else if(d.productDelete?.deletedProductId)deleted.push(d.productDelete.deletedProductId);
        }catch(e){errors.push({id,error:e.message||'delete failed'})}
      }
      return res.status(errors.length?207:200).json({ok:errors.length===0,deletedCount:deleted.length,errorCount:errors.length,deleted,errors});
    }
    return res.status(200).json({ok:true,totalDrafts:rows.length,duplicateGroups:groups.length,groups,drafts:rows.map(p=>({id:p.id,title:p.title,handle:p.handle,skus:(p.variants?.nodes||[]).map(v=>String(v.sku||'').trim()).filter(Boolean)}))});
  }catch(e){return res.status(500).json({ok:false,error:e.message||'重複チェックに失敗しました'})}
}