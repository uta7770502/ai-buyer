const VERSION='2026-10';
const ORIGIN='https://ai-buyer-nine.vercel.app';

function safeShop(v){
  const s=String(v||'').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)?s:'';
}
function xml(v){
  return String(v||'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
}

export default async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).end();
  }
  res.setHeader('Content-Type','application/xml; charset=utf-8');
  res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=900');

  const shop=safeShop(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN);
  const token=String(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN||'').trim();
  const urls=[{loc:ORIGIN+'/shop',priority:'1.0'}];

  if(shop&&token){
    const query=`query SitemapProducts($first:Int!,$after:String){
      products(first:$first,after:$after,sortKey:UPDATED_AT,reverse:true){
        nodes{handle updatedAt}
        pageInfo{hasNextPage endCursor}
      }
    }`;
    try{
      let after=null,more=true,pages=0;
      while(more&&pages<10){
        const r=await fetch('https://'+shop+'/api/'+VERSION+'/graphql.json',{
          method:'POST',
          headers:{'Content-Type':'application/json','X-Shopify-Storefront-Access-Token':token},
          body:JSON.stringify({query,variables:{first:100,after}}),
          signal:AbortSignal.timeout(10000)
        });
        const j=await r.json();
        if(!r.ok||j.errors?.length)throw Error('Shopify sitemap query failed');
        const connection=j.data?.products;
        if(!Array.isArray(connection?.nodes)||!connection?.pageInfo)throw Error('Invalid Shopify sitemap response');
        for(const p of connection.nodes){
          if(!p?.handle)continue;
          urls.push({
            loc:ORIGIN+'/shop?product='+encodeURIComponent(p.handle),
            lastmod:p.updatedAt||''
          });
        }
        more=connection.pageInfo.hasNextPage===true;
        after=connection.pageInfo.endCursor||null;
        if(more&&!after)throw Error('Shopify sitemap cursor missing');
        pages++;
      }
    }catch{
      // Fail soft: keep storefront URL available without exposing internal errors.
    }
  }

  const body='<?xml version="1.0" encoding="UTF-8"?>\n'
    +'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    +urls.map(u=>'  <url><loc>'+xml(u.loc)+'</loc>'+(u.lastmod?'<lastmod>'+xml(u.lastmod)+'</lastmod>':'')+(u.priority?'<priority>'+u.priority+'</priority>':'')+'</url>').join('\n')
    +'\n</urlset>';
  return res.status(200).send(body);
}
