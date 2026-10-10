import crypto from 'crypto';
function cfg(){
  const shop=String(process.env.SHOPIFY_SHOP||'').trim().replace(/\.myshopify\.com$/i,'');
  const allowed=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*$/.test(shop)||shop.toLowerCase()+'.myshopify.com'!==allowed)throw Error('SHOPIFY_SHOP と許可ストアの設定を確認してください');
  const clientId=String(process.env.SHOPIFY_CLIENT_ID||'').trim();
  const missing=[];if(!shop)missing.push('SHOPIFY_SHOP');if(!clientId)missing.push('SHOPIFY_CLIENT_ID');if(missing.length)throw Error('未設定: '+missing.join(', '));
  const appBase=String(process.env.SHOPIFY_WEBHOOK_BASE_URL||'').trim().replace(/\/$/,'');
  if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(appBase))throw Error('SHOPIFY_WEBHOOK_BASE_URL を確認してください');
  return {shop,clientId,appBase};
}
export default async function handler(req,res){
  try{
    const {shop,clientId,appBase}=cfg();
    const state=crypto.randomBytes(24).toString('hex');
    res.setHeader('Set-Cookie',`shopify_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    const redirectUri=appBase+'/api/shopify-callback';
    const scopes='read_products,write_products,read_publications,write_publications,read_orders,write_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,unauthenticated_read_product_listings';
    const u=new URL('https://'+shop+'.myshopify.com/admin/oauth/authorize');
    u.searchParams.set('client_id',clientId);
    u.searchParams.set('scope',scopes);
    u.searchParams.set('redirect_uri',redirectUri);
    u.searchParams.set('state',state);
    return res.redirect(302,u.toString());
  }catch(e){return res.status(500).send('Shopify認証を開始できません: '+e.message)}
}