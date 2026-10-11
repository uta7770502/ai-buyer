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
    const d=await gql(shop,token,'query AiBuyerProducts($q:String!){ products(first:100, query:$q) { nodes { id title handle status vendor productType featuredMedia { preview { image { url } } } audience:metafield(namespace:"custom",key:"adps_audience"){value} adpsSummary:metafield(namespace:"custom",key:"adps_summary"){value} adpsWhy:metafield(namespace:"custom",key:"adps_why"){value} variants(first:10){nodes{id sku price}} } } }',{q:'vendor:AI BUYER'});
    const allRows=d.products?.nodes||[];
    const rows=allRows.filter(p=>p.status==='DRAFT');
    const activeRows=allRows.filter(p=>p.status==='ACTIVE');
    const items=rows.map(p=>({id:p.id,title:p.title,handle:p.handle,skus:(p.variants?.nodes||[]).map(v=>String(v.sku||'').trim()).filter(Boolean)}));
    const parent=items.map((_,i)=>i);
    const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
    const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a};
    for(let i=0;i<items.length;i++){
      for(let j=i+1;j<items.length;j++){
        const sameTitle=String(items[i].title||'').trim().toLowerCase()===String(items[j].title||'').trim().toLowerCase();
        const sameSku=items[i].skus.some(s=>items[j].skus.includes(s));
        if(sameTitle||sameSku)union(i,j);
      }
    }
    const buckets=new Map();
    items.forEach((it,i)=>{const r=find(i);if(!buckets.has(r))buckets.set(r,[]);buckets.get(r).push({id:it.id,title:it.title,handle:it.handle,sku:it.skus[0]||''})});
    const groups=[...buckets.values()].filter(arr=>arr.length>1).map(arr=>({key:'duplicate',count:arr.length,items:arr}));
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
    return res.status(200).json({ok:true,totalDrafts:rows.length,totalActive:activeRows.length,duplicateGroups:groups.length,groups,published:activeRows.map(p=>{const audience=String(p.audience?.value||'').trim(),summary=String(p.adpsSummary?.value||'').trim(),why=String(p.adpsWhy?.value||'').trim();return {id:p.id,title:p.title,handle:p.handle,productType:p.productType||'',image:p.featuredMedia?.preview?.image?.url||'',skus:(p.variants?.nodes||[]).map(v=>String(v.sku||'').trim()).filter(Boolean),prices:(p.variants?.nodes||[]).map(v=>String(v.price||'')).filter(Boolean),audience,summary,why,aioReady:Boolean(audience&&summary&&why)}}),drafts:rows.map(p=>{
      const skus=(p.variants?.nodes||[]).map(v=>String(v.sku||'').trim()).filter(Boolean);
      const prices=(p.variants?.nodes||[]).map(v=>String(v.price||'')).filter(Boolean);
      const image=p.featuredMedia?.preview?.image?.url||'';
      const productType=p.productType||'';
      const pet=/\b(cat|dog|pet|puppy|kitten|carrier)\b/i.test(String(p.title||''));
      const issues=[];
      if(!skus.length)issues.push('SKU未設定');
      if(!prices.length||prices.some(v=>!(Number(v)>0)))issues.push('価格未設定');
      if(!image)issues.push('画像未設定');
      if(!productType)issues.push('カテゴリ未設定');
      if(pet&&!/pet/i.test(productType))issues.push('Petカテゴリ未設定');
      return {id:p.id,title:p.title,handle:p.handle,productType,image,skus,prices,ready:issues.length===0,issues};
    })});
  }catch(e){return res.status(500).json({ok:false,error:e.message||'重複チェックに失敗しました'})}
}