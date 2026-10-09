const VERSION='2026-10';
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables})});
  const j=await r.json();if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify API request failed');return j.data;
}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const c=cookies(req),token=String(c.shopify_access_token||''),shop=String(c.shopify_connected_shop||'');
    if(!token||!shop)return res.status(401).json({ok:false,authRequired:true,error:'Shopify認証が必要です'});
    const b=req.body||{},productId=String(b.productId||''),variantId=String(b.variantId||''),action=String(b.action||'').toLowerCase(),price=Number(b.price);
    if(!productId)return res.status(400).json({ok:false,error:'Shopify商品IDが必要です'});
    if(!['stop','resume','price'].includes(action))return res.status(400).json({ok:false,error:'同期アクションが不正です'});

    if(action==='price'){
      if(!variantId||!Number.isFinite(price)||price<=0)return res.status(400).json({ok:false,error:'価格同期に必要な情報が不足しています'});
      const d=await gql(shop,token,'mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId:$productId, variants:$variants) { productVariants { id price } userErrors { field message } } }',{productId,variants:[{id:variantId,price:String(Math.round(price))}]});
      const errs=d.productVariantsBulkUpdate?.userErrors||[];if(errs.length)throw Error(errs.map(x=>x.message).join(' / '));
      return res.status(200).json({ok:true,action:'price',price:Math.round(price)});
    }

    const status=action==='stop'?'DRAFT':'ACTIVE';
    const d=await gql(shop,token,'mutation UpdateProduct($product: ProductUpdateInput!) { productUpdate(product:$product) { product { id status } userErrors { field message } } }',{product:{id:productId,status}});
    const errs=d.productUpdate?.userErrors||[];if(errs.length)throw Error(errs.map(x=>x.message).join(' / '));

    if(action==='resume'){
      const pubs=await gql(shop,token,'query Publications { publications(first:20) { nodes { id name autoPublish } } }');
      const nodes=pubs.publications?.nodes||[];
      const target=nodes.find(x=>/online store/i.test(String(x.name||'')))||nodes.find(x=>x.autoPublish)||nodes[0];
      if(target){
        const p=await gql(shop,token,'mutation Publish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id:$id, input:$input) { userErrors { field message } } }',{id:productId,input:[{publicationId:target.id}]});
        const pe=p.publishablePublish?.userErrors||[];if(pe.length)throw Error(pe.map(x=>x.message).join(' / '));
      }
    }
    return res.status(200).json({ok:true,action,status});
  }catch(e){return res.status(500).json({ok:false,error:e.message||'Shopify同期に失敗しました'})}
}