const VERSION='2026-10';

function safeShop(v){
  const s=String(v||'').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)?s:'';
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','public, s-maxage=120, stale-while-revalidate=300');
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({ok:false,error:'Method not allowed'});
  }

  const shop=safeShop(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN);
  const token=String(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN||'').trim();
  if(!shop||!token){
    return res.status(503).json({ok:false,configured:false,error:'Shopify Storefront API is not configured'});
  }

  const query=`
    query StorefrontProducts($first:Int!){
      products(first:$first, sortKey:UPDATED_AT, reverse:true){
        nodes{
          id
          handle
          title
          description
          productType
          vendor
          onlineStoreUrl
          featuredImage{url altText width height}
          audience:metafield(namespace:"custom",key:"adps_audience"){value}
          adpsSummary:metafield(namespace:"custom",key:"adps_summary"){value}
          adpsWhy:metafield(namespace:"custom",key:"adps_why"){value}
          shippingPrice:metafield(namespace:"custom",key:"shipping_price_jpy"){value}
          shippingCountry:metafield(namespace:"custom",key:"shipping_country"){value}
          returnDays:metafield(namespace:"custom",key:"return_days"){value}
          variants(first:1){
            nodes{
              id
              sku
              availableForSale
              price{amount currencyCode}
            }
          }
        }
      }
    }`;

  try{
    const r=await fetch('https://'+shop+'/api/'+VERSION+'/graphql.json',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'X-Shopify-Storefront-Access-Token':token
      },
      body:JSON.stringify({query,variables:{first:24}}),
      signal:AbortSignal.timeout(10000)
    });

    let j={};
    try{j=await r.json()}catch{}
    if(!r.ok||j.errors?.length){
      const msg=j.errors?.[0]?.message||'Shopify Storefront API request failed';
      return res.status(r.status===401||r.status===403?401:502).json({ok:false,error:msg});
    }

    const nodes=Array.isArray(j.data?.products?.nodes)?j.data.products.nodes:[];
    const products=nodes.map(p=>{
      const v=p.variants?.nodes?.[0]||{};
      const amount=Number(v.price?.amount||0);
      return {
        id:String(p.handle||p.id||''),
        title:String(p.title||''),
        description:String(p.description||''),
        productType:String(p.productType||''),
        vendor:String(p.vendor||''),
        onlineStoreUrl:String(p.onlineStoreUrl||''),
        featuredImage:p.featuredImage?{
          url:String(p.featuredImage.url||''),
          altText:String(p.featuredImage.altText||p.title||'')
        }:null,
        audience:String(p.audience?.value||''),
        summary:String(p.adpsSummary?.value||''),
        why:String(p.adpsWhy?.value||'').split(/\r?\n|\|/).map(x=>x.trim()).filter(Boolean).slice(0,6),
        shipping:p.shippingPrice?.value?{
          price:Number(p.shippingPrice.value||0),
          country:String(p.shippingCountry?.value||'JP').toUpperCase(),
          handlingMin:1,handlingMax:3,transitMin:1,transitMax:5
        }:null,
        returnPolicy:p.returnDays?.value?{
          days:Number(p.returnDays.value||0),
          country:String(p.shippingCountry?.value||'JP').toUpperCase()
        }:null,
        variant:{
          id:String(v.id||''),
          sku:String(v.sku||''),
          availableForSale:v.availableForSale===true,
          price:{
            amount:Number.isFinite(amount)?amount:0,
            currencyCode:String(v.price?.currencyCode||'JPY')
          }
        },
        authoritative:true
      };
    }).filter(p=>p.id&&p.title&&p.variant.price.amount>0);

    return res.status(200).json({
      ok:true,
      source:'shopify-storefront',
      authoritative:true,
      count:products.length,
      checkedAt:new Date().toISOString(),
      products
    });
  }catch(e){
    return res.status(503).json({ok:false,error:e?.name==='TimeoutError'?'Shopify Storefront API timed out':'Unable to load Shopify storefront products'});
  }
}
