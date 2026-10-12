// Server-rendered ODDLY product page. Keep noindex until the live commerce release is approved.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[c]));
const shopDomain=v=>/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(String(v||'').toLowerCase())?String(v).toLowerCase():'';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).send('Method not allowed');
  const handle=String(req.query.handle||'');
  if(!/^[a-z0-9][a-z0-9-]{0,180}$/.test(handle))return res.status(404).send('Not found');
  const shop=shopDomain(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN);
  const token=String(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN||'');
  if(!shop||!token)return res.status(503).send('Shop unavailable');
  const query=`query ProductPage($handle:String!){product(handle:$handle){title description productType featuredImage{url altText} variants(first:1){nodes{availableForSale price{amount currencyCode}}}}}`;
  try{
    const response=await fetch('https://'+shop+'/api/2026-10/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Storefront-Access-Token':token},body:JSON.stringify({query,variables:{handle}}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)return res.status(502).send('Product service unavailable');
    const json=await response.json();
    if(json.errors?.length)return res.status(502).send('Product service unavailable');
    const p=json.data?.product;
    if(!p)return res.status(404).send('Product not found');
    const v=p.variants?.nodes?.[0],price=Number(v?.price?.amount),currency=v?.price?.currencyCode;
    const base='https://ai-buyer-nine.vercel.app';
    const url=base+'/shop/products/'+encodeURIComponent(handle);
    const image=String(p.featuredImage?.url||'');
    const validImage=/^https:\/\//.test(image)?image:'';
    const description=String(p.description||'').trim();
    const schema={'@context':'https://schema.org','@type':'Product',name:p.title,description:description||undefined,image:validImage?[validImage]:undefined,url,offers:Number.isFinite(price)&&price>0&&currency==='JPY'?{'@type':'Offer',price:price.toFixed(0),priceCurrency:'JPY',availability:v.availableForSale?'https://schema.org/InStock':'https://schema.org/OutOfStock',url}:undefined};
    const ld=JSON.stringify(schema).replace(/</g,'\\u003c');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag','noindex, follow');
    return res.status(200).send(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${esc(p.title)} | ODDLY</title><meta name="description" content="${esc(description.slice(0,155)||p.title)}"><link rel="canonical" href="${esc(url)}"><meta property="og:title" content="${esc(p.title)} | ODDLY"><meta property="og:description" content="${esc(description.slice(0,155))}"><meta property="og:url" content="${esc(url)}"><script type="application/ld+json">${ld}</script><style>body{margin:0;background:#f6f5ef;color:#161616;font:16px/1.7 system-ui,sans-serif}header,main,footer{max-width:960px;margin:auto;padding:20px}header{border-bottom:1px solid #ddd}header a{color:inherit;text-decoration:none;font-weight:900;font-size:26px}main{display:grid;grid-template-columns:1fr 1fr;gap:32px;padding-top:44px}img{width:100%;height:auto;border-radius:14px}h1{font-size:clamp(26px,4vw,42px);line-height:1.25}.price{font-weight:800;font-size:24px}.note{color:#666;font-size:14px}a{color:inherit}@media(max-width:650px){main{grid-template-columns:1fr}}</style></head><body><header><a href="/shop">ODDLY</a></header><main><section>${validImage?`<img src="${esc(validImage)}" alt="${esc(p.featuredImage?.altText||p.title)}">`:''}</section><section><p>${esc(p.productType||'SELECTED GOODS')}</p><h1>${esc(p.title)}</h1>${Number.isFinite(price)&&price>0&&currency==='JPY'?`<p class="price">¥${Math.round(price).toLocaleString('ja-JP')}</p>`:''}<p>${esc(description)}</p><p class="note">${v?.availableForSale?'在庫状況は購入前にご確認ください。':'現在は在庫切れです。'}</p><p class="note">配送・返品条件は販売開始前にご案内します。</p><a href="/shop">ショップに戻る →</a></section></main><footer>© ODDLY</footer></body></html>`);
  }catch{return res.status(503).send('Product temporarily unavailable')}
}
