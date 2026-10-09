const VERSION='2026-10';
let tokenCache={token:'',expiresAt:0};
function cfg(){
  const shop=String(process.env.SHOPIFY_SHOP||'').trim().replace(/\.myshopify\.com$/i,'');
  const clientId=String(process.env.SHOPIFY_CLIENT_ID||'').trim();
  const clientSecret=String(process.env.SHOPIFY_CLIENT_SECRET||'').trim();
  const publicationId=String(process.env.SHOPIFY_PUBLICATION_ID||'').trim();
  if(!shop||!clientId||!clientSecret)throw Error('Shopify環境変数が未設定です');
  return {shop,clientId,clientSecret,publicationId};
}
async function getToken(){
  if(tokenCache.token&&Date.now()<tokenCache.expiresAt-60000)return tokenCache.token;
  const {shop,clientId,clientSecret}=cfg();
  const r=await fetch('https://'+shop+'.myshopify.com/admin/oauth/access_token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret})
  });
  const j=await r.json();
  if(!r.ok||!j.access_token)throw Error(j.error_description||j.error||'Shopifyトークン取得に失敗しました');
  tokenCache={token:j.access_token,expiresAt:Date.now()+Number(j.expires_in||86399)*1000};
  return tokenCache.token;
}
async function gql(query,variables={}){
  const {shop}=cfg(),token=await getToken();
  const r=await fetch('https://'+shop+'.myshopify.com/admin/api/'+VERSION+'/graphql.json',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},
    body:JSON.stringify({query,variables})
  });
  const j=await r.json();
  if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify API request failed');
  return j.data;
}
function cleanText(v,max=5000){return String(v||'').replace(/[<>]/g,'').trim().slice(0,max)}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const {publicationId}=cfg(),p=req.body||{};
    const title=cleanText(p.title||p.name,255),description=cleanText(p.description||p.descriptionHtml,5000),vendor=cleanText(p.vendor||'AI BUYER',255),price=Number(p.price);
    if(!title||!Number.isFinite(price)||price<=0)return res.status(400).json({ok:false,error:'商品名と販売価格が必要です'});
    const create=await gql(
      'mutation CreateProduct($product: ProductCreateInput!) { productCreate(product:$product) { product { id title handle status variants(first:1){nodes{id}} } userErrors { field message } } }',
      {product:{title,descriptionHtml:description,vendor,status:'ACTIVE',tags:['AI BUYER','dropshipping']}}
    );
    const ce=create.productCreate;
    if(ce.userErrors?.length||!ce.product)throw Error(ce.userErrors?.map(x=>x.message).join(' / ')||'商品作成に失敗しました');
    const variantId=ce.product.variants?.nodes?.[0]?.id;
    if(!variantId)throw Error('Shopify variant IDを取得できませんでした');
    const update=await gql(
      'mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId:$productId, variants:$variants) { productVariants { id price } userErrors { field message } } }',
      {productId:ce.product.id,variants:[{id:variantId,price:String(Math.round(price))}]}
    );
    if(update.productVariantsBulkUpdate?.userErrors?.length)throw Error(update.productVariantsBulkUpdate.userErrors.map(x=>x.message).join(' / '));
    let published=false;
    if(publicationId){
      const pub=await gql(
        'mutation Publish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id:$id, input:$input) { userErrors { field message } } }',
        {id:ce.product.id,input:[{publicationId}]}
      );
      const errs=pub.publishablePublish?.userErrors||[];
      if(errs.length)throw Error(errs.map(x=>x.message).join(' / '));
      published=true;
    }
    return res.status(200).json({ok:true,productId:ce.product.id,variantId,title:ce.product.title,handle:ce.product.handle,published,publicationConfigured:Boolean(publicationId)});
  }catch(e){return res.status(500).json({ok:false,error:e.message||'Shopify自動出品に失敗しました'})}
}