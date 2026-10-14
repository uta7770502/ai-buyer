// Server-rendered ODDLY product page. Keep noindex until the live commerce release is approved.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[c]));
const shopDomain=v=>/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(String(v||'').toLowerCase())?String(v).toLowerCase():'';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const searchIndexEnabled=process.env.ODDLY_SEARCH_INDEX_ENABLED==='true';
  if(req.method!=='GET')return res.status(405).send('Method not allowed');
  const handle=String(req.query.handle||'');
  if(!/^[a-z0-9][a-z0-9-]{0,180}$/.test(handle))return res.status(404).send('Not found');
  const shop=shopDomain(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN);
  const token=String(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN||'');
  if(!shop||!token)return res.status(503).send('Shop unavailable');
  const query=`query ProductPage($handle:String!){product(handle:$handle){title description productType vendor featuredImage{url altText} audience:metafield(namespace:"custom",key:"adps_audience"){value} adpsSummary:metafield(namespace:"custom",key:"adps_summary"){value} adpsWhy:metafield(namespace:"custom",key:"adps_why"){value} shippingPrice:metafield(namespace:"custom",key:"shipping_price_jpy"){value} shippingCountry:metafield(namespace:"custom",key:"shipping_country"){value} returnDays:metafield(namespace:"custom",key:"return_days"){value} variants(first:1){nodes{availableForSale sku price{amount currencyCode}}}}}`;
  try{
    const response=await fetch('https://'+shop+'/api/2026-10/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Storefront-Access-Token':token},body:JSON.stringify({query,variables:{handle}}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)return res.status(502).send('Product service unavailable');
    const json=await response.json();
    if(json.errors?.length)return res.status(502).send('Product service unavailable');
    const p=json.data?.product;
    if(!p)return res.status(404).send('Product not found');
    const v=p.variants?.nodes?.[0],price=v?.price?.amount==null?NaN:Number(v.price.amount),currency=v?.price?.currencyCode;
    const base='https://ai-buyer-nine.vercel.app';
    const url=base+'/shop/products/'+encodeURIComponent(handle);
    const image=String(p.featuredImage?.url||'');
    const validImage=/^https:\/\//.test(image)?image:'';
    const description=String(p.description||'').trim();
    const summary=String(p.adpsSummary?.value||'').trim()||description;
    const audience=String(p.audience?.value||'').trim();
    const why=String(p.adpsWhy?.value||'').split(/\r?\n|\|/).map(x=>x.trim()).filter(Boolean).slice(0,6);
    const shippingPrice=Number(p.shippingPrice?.value);
    const shippingCountry=String(p.shippingCountry?.value||'JP').toUpperCase();
    const returnDays=Number(p.returnDays?.value);
    const shipping=Number.isFinite(shippingPrice)&&shippingPrice>=0?{price:shippingPrice,country:shippingCountry}:null;
    const returns=Number.isInteger(returnDays)&&returnDays>0?{days:returnDays,country:shippingCountry}:null;
    const hasValidOffer=Number.isFinite(price)&&price>0&&currency==='JPY'&&typeof v?.availableForSale==='boolean';
    const offer=hasValidOffer?{'@type':'Offer',price:price.toFixed(0),priceCurrency:'JPY',availability:v.availableForSale?'https://schema.org/InStock':'https://schema.org/OutOfStock',url}:undefined;
    if(offer&&shipping)offer.shippingDetails={'@type':'OfferShippingDetails','shippingRate':{'@type':'MonetaryAmount','value':shipping.price,'currency':'JPY'},'shippingDestination':{'@type':'DefinedRegion','addressCountry':shipping.country}};
    if(offer&&returns)offer.hasMerchantReturnPolicy={'@type':'MerchantReturnPolicy','applicableCountry':returns.country,'returnPolicyCategory':'https://schema.org/MerchantReturnFiniteReturnWindow','merchantReturnDays':returns.days};
    const schema={'@context':'https://schema.org','@type':'Product',name:p.title,description:summary||undefined,image:validImage?[validImage]:undefined,url,...(v?.sku?{sku:String(v.sku)}:{}),...(p.vendor?{brand:{'@type':'Brand',name:String(p.vendor)}}:{}),...(audience?{audience:{'@type':'Audience',audienceType:audience}}:{}),offers:offer};
    const ld=JSON.stringify(schema).replace(/</g,'\\u003c');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag',searchIndexEnabled?'index, follow':'noindex, follow');
    return res.status(200).send(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${searchIndexEnabled?'index,follow':'noindex,follow'}"><title>${esc(p.title)} | ODDLY</title><meta name="description" content="${esc((summary||p.title).slice(0,155))}"><link rel="canonical" href="${esc(url)}"><meta property="og:title" content="${esc(p.title)} | ODDLY"><meta property="og:description" content="${esc((summary||p.title).slice(0,155))}"><meta property="og:url" content="${esc(url)}"><script type="application/ld+json">${ld}</script><style>body{margin:0;background:#f6f5ef;color:#161616;font:16px/1.7 system-ui,sans-serif}header,main,footer{max-width:960px;margin:auto;padding:20px}header{border-bottom:1px solid #ddd}header a{color:inherit;text-decoration:none;font-weight:900;font-size:26px}main{display:grid;grid-template-columns:1fr 1fr;gap:32px;padding-top:44px}img{width:100%;height:auto;border-radius:14px}h1{font-size:clamp(26px,4vw,42px);line-height:1.25}.price{font-weight:800;font-size:24px}.note{color:#666;font-size:14px}a{color:inherit}@media(max-width:650px){main{grid-template-columns:1fr}}</style></head><body><header><a href="/shop">ODDLY</a></header><main><section>${validImage?`<img src="${esc(validImage)}" alt="${esc(p.featuredImage?.altText||p.title)}">`:''}</section><section><p>${esc(p.productType||'SELECTED GOODS')}</p><h1>${esc(p.title)}</h1>${Number.isFinite(price)&&price>0&&currency==='JPY'?`<p class="price">¥${Math.round(price).toLocaleString('ja-JP')}</p>`:''}<p>${esc(summary)}</p>${audience?`<section><h2>こんな人におすすめ</h2><p>${esc(audience)}</p></section>`:''}${why.length?`<section><h2>ODDLYのおすすめポイント</h2><ul>${why.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`:''}<section><h2>購入前に確認</h2><p class="note">${v?.availableForSale?'在庫状況は購入前にご確認ください。':'現在は在庫切れです。'}</p><p class="note">${shipping?`配送先：${esc(shipping.country)} / 送料：${shipping.price===0?'無料':('¥'+Math.round(shipping.price).toLocaleString('ja-JP'))}`:'送料・配送条件は確認中です。'}</p><p class="note">${returns?`返品受付期間：${returns.days}日`:'返品条件は確認中です。'}</p></section><a href="/shop">ショップに戻る →</a></section></main><footer>© ODDLY</footer></body></html>`);
  }catch{return res.status(503).send('Product temporarily unavailable')}
}
