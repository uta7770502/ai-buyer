const VERSION='2026-10';
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables})});
  const j=await r.json();if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify API request failed');return j.data;
}
function clean(v,max=5000){return String(v||'').replace(/[<>]/g,'').trim().slice(0,max)}
let cjCache={token:'',expiresAt:0};
async function cjToken(){
  if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
  if(cjCache.token&&Date.now()<cjCache.expiresAt-60000)return cjCache.token;
  if(!process.env.CJ_API_KEY)throw Error('CJ_API_KEY is not configured');
  const r=await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:process.env.CJ_API_KEY})});
  const j=await r.json();if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error(j.message||'CJ authentication failed');
  cjCache={token:j.data.accessToken,expiresAt:Date.now()+12*60*60*1000};return cjCache.token;
}
async function cjVariant(productId){
  if(!productId)throw Error('CJ商品IDが不足しています');
  const u=new URL('https://developers.cjdropshipping.com/api2.0/v1/product/query');u.searchParams.set('pid',String(productId));
  const r=await fetch(u,{headers:{'CJ-Access-Token':await cjToken()}});const j=await r.json();
  if(!r.ok||j.result!==true)throw Error(j.message||'CJ商品情報を取得できません');
  const p=j.data||{},vs=Array.isArray(p.variants)?p.variants:Array.isArray(p.variantList)?p.variantList:[];
  const v=vs.find(x=>x&&(x.vid||x.id||x.variantId));
  if(!v)throw Error('CJバリエーションIDを取得できません');
  return {vid:String(v.vid||v.id||v.variantId),sku:String(v.variantSku||v.sku||''),productId:String(p.pid||p.id||productId)};
}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const c=cookies(req),token=String(c.shopify_access_token||''),shop=String(c.shopify_connected_shop||'');
    if(!token||!shop)return res.status(401).json({ok:false,authRequired:true,error:'Shopify認証が必要です'});
    const p=req.body||{},title=clean(p.title||p.name,255),description=clean(p.description||p.descriptionHtml,5000),vendor=clean(p.vendor||'AI BUYER',255),price=Number(p.price);
    if(!title||!Number.isFinite(price)||price<=0)return res.status(400).json({ok:false,error:'商品名と販売価格が必要です'});
    const cj=await cjVariant(p.cjProductId||p.id);
    const create=await gql(shop,token,'mutation CreateProduct($product: ProductCreateInput!) { productCreate(product:$product) { product { id title handle status variants(first:1){nodes{id}} } userErrors { field message } } }',{product:{title,descriptionHtml:description,vendor,status:'ACTIVE',tags:['AI BUYER','dropshipping']}});
    const ce=create.productCreate;if(ce.userErrors?.length||!ce.product)throw Error(ce.userErrors?.map(x=>x.message).join(' / ')||'商品作成に失敗しました');
    const variantId=ce.product.variants?.nodes?.[0]?.id;if(!variantId)throw Error('Shopify variant IDを取得できませんでした');
    const update=await gql(shop,token,'mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId:$productId, variants:$variants) { productVariants { id price } userErrors { field message } } }',{productId:ce.product.id,variants:[{id:variantId,price:String(Math.round(price)),sku:cj.vid}]});
    if(update.productVariantsBulkUpdate?.userErrors?.length)throw Error(update.productVariantsBulkUpdate.userErrors.map(x=>x.message).join(' / '));
    const pubs=await gql(shop,token,'query Publications { publications(first:20) { nodes { id name autoPublish } } }');
    const nodes=pubs.publications?.nodes||[];
    const target=nodes.find(x=>/online store/i.test(String(x.name||'')))||nodes.find(x=>x.autoPublish)||nodes[0];
    if(!target)throw Error('Shopify公開先を取得できませんでした');
    const publish=await gql(shop,token,'mutation Publish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id:$id, input:$input) { userErrors { field message } } }',{id:ce.product.id,input:[{publicationId:target.id}]});
    const errs=publish.publishablePublish?.userErrors||[];
    if(errs.length)throw Error(errs.map(x=>x.message).join(' / '));
    return res.status(200).json({ok:true,productId:ce.product.id,variantId,title:ce.product.title,handle:ce.product.handle,published:true,publicationConfigured:true,publicationName:target.name,cjVariantId:cj.vid,cjVariantSku:cj.sku,cjProductId:cj.productId});
  }catch(e){return res.status(500).json({ok:false,error:e.message||'Shopify自動出品に失敗しました'})}
}