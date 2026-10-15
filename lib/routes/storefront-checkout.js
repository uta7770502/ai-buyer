const VERSION='2026-10';

function safeShop(v){
  const s=String(v||'').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)?s:'';
}
function validVariantId(v){return /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(String(v||''))}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  if(String(process.env.ODDLY_CHECKOUT_ENABLED||'').toLowerCase()!=='true'){
    return res.status(503).json({ok:false,checkoutEnabled:false,error:'Checkout is disabled until final launch'});
  }
  const shop=safeShop(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN);
  const token=String(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN||'').trim();
  if(!shop||!token)return res.status(503).json({ok:false,error:'Storefront API is not configured'});
  const input=Array.isArray(req.body?.lines)?req.body.lines:[];
  if(!input.length||input.length>10)return res.status(400).json({ok:false,error:'Cart must contain 1 to 10 items'});
  const lines=[];
  let totalQty=0;
  for(const row of input){
    const merchandiseId=String(row?.merchandiseId||'');
    const quantity=Number(row?.quantity);
    if(!validVariantId(merchandiseId)||!Number.isSafeInteger(quantity)||quantity<1||quantity>20){
      return res.status(400).json({ok:false,error:'Invalid cart item'});
    }
    totalQty+=quantity;
    if(totalQty>50)return res.status(400).json({ok:false,error:'Cart quantity limit exceeded'});
    lines.push({merchandiseId,quantity});
  }
  const query=`mutation CreateCart($input:CartInput!){
    cartCreate(input:$input){
      cart{id checkoutUrl totalQuantity}
      userErrors{field message}
    }
  }`;
  try{
    const r=await fetch('https://'+shop+'/api/'+VERSION+'/graphql.json',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Shopify-Storefront-Access-Token':token},
      body:JSON.stringify({query,variables:{input:{lines}}}),
      signal:AbortSignal.timeout(10000)
    });
    const j=await r.json().catch(()=>({}));
    const out=j.data?.cartCreate,errors=out?.userErrors||[];
    if(!r.ok||j.errors?.length||errors.length||!out?.cart?.checkoutUrl){
      return res.status(502).json({ok:false,error:errors.map(x=>x.message).join(' / ')||j.errors?.[0]?.message||'Unable to create Shopify checkout'});
    }
    const checkoutUrl=String(out.cart.checkoutUrl||'');
    if(!/^https:\/\//i.test(checkoutUrl))return res.status(502).json({ok:false,error:'Invalid checkout URL'});
    return res.status(200).json({ok:true,checkoutEnabled:true,checkoutUrl,totalQuantity:Number(out.cart.totalQuantity||totalQty)});
  }catch(e){
    return res.status(503).json({ok:false,error:e?.name==='TimeoutError'?'Shopify checkout timed out':'Unable to create Shopify checkout'});
  }
}
