const VERSION='2026-10';
function cfg(){
  const shop=String(process.env.SHOPIFY_STORE_DOMAIN||'').trim().replace(/^https?:\/\//,'').replace(/\/$/,'');
  const token=String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||'').trim();
  const publicationId=String(process.env.SHOPIFY_PUBLICATION_ID||'').trim();
  if(!shop||!token)throw Error('Shopify connection is not configured');
  return {shop,token,publicationId};
}
async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{
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
    const {shop,token,publicationId}=cfg();
    const p=req.body||{};
    const title=cleanText(p.title||p.name,255);
    const description=cleanText(p.description||p.descriptionHtml,5000);
    const vendor=cleanText(p.vendor||'AI BUYER',255);
    const price=Number(p.price);
    if(!title||!Number.isFinite(price)||price<=0)return res.status(400).json({ok:false,error:'商品名と販売価格が必要です'});
    const media=Array.isArray(p.images)?p.images.filter(x=>/^https?:\/\//i.test(String(x))).slice(0,8).map((x,i)=>({originalSource:String(x),mediaContentType:'IMAGE',alt:title+(i?' '+(i+1):'')})):[];
    const create=await gql(shop,token,
      'mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) { productCreate(product:$product, media:$media) { product { id title handle status variants(first:1){nodes{id}} } userErrors { field message } } }',
      {product:{title,descriptionHtml:description,vendor,status:'ACTIVE',tags:['AI BUYER','dropshipping']},media}
    );
    const ce=create.productCreate;
    if(ce.userErrors?.length||!ce.product)throw Error(ce.userErrors?.map(x=>x.message).join(' / ')||'商品作成に失敗しました');
    const variantId=ce.product.variants?.nodes?.[0]?.id;
    if(!variantId)throw Error('Shopify variant IDを取得できませんでした');
    const update=await gql(shop,token,
      'mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId:$productId, variants:$variants) { productVariants { id price } userErrors { field message } } }',
      {productId:ce.product.id,variants:[{id:variantId,price:String(Math.round(price))}]}
    );
    if(update.productVariantsBulkUpdate?.userErrors?.length)throw Error(update.productVariantsBulkUpdate.userErrors.map(x=>x.message).join(' / '));
    let published=false;
    if(publicationId){
      const pub=await gql(shop,token,
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