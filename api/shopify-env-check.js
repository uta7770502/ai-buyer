function normalizeHost(v){
  return String(v||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'');
}
export default function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const rawShop=normalizeHost(process.env.SHOPIFY_SHOP);
  const rawAllowed=normalizeHost(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN);
  const shop=rawShop.replace(/\.myshopify\.com$/i,'');
  const expected=shop?shop+'.myshopify.com':'';
  const validShop=/^[a-z0-9][a-z0-9-]*$/.test(shop);
  const validAllowed=/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(rawAllowed);
  return res.status(200).json({
    ok:true,
    shopConfigured:Boolean(rawShop),
    allowedConfigured:Boolean(rawAllowed),
    normalizedShop:shop,
    expectedAllowedDomain:expected,
    normalizedAllowedDomain:rawAllowed,
    validShop,
    validAllowed,
    matches:Boolean(validShop&&validAllowed&&expected===rawAllowed)
  });
}
