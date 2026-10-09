import crypto from 'crypto';
function cfg(){
  const shop=String(process.env.SHOPIFY_SHOP||'').trim().replace(/\.myshopify\.com$/i,'');
  const clientId=String(process.env.SHOPIFY_CLIENT_ID||'').trim();
  const missing=[];if(!shop)missing.push('SHOPIFY_SHOP');if(!clientId)missing.push('SHOPIFY_CLIENT_ID');if(missing.length)throw Error('未設定: '+missing.join(', '));
  return {shop,clientId};
}
export default async function handler(req,res){
  try{
    const {shop,clientId}=cfg();
    const state=crypto.randomBytes(24).toString('hex');
    res.setHeader('Set-Cookie',`shopify_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    const redirectUri='https://ai-buyer-nine.vercel.app/api/shopify-callback';
    const scopes='read_products,write_products,read_publications,write_publications';
    const u=new URL('https://'+shop+'.myshopify.com/admin/oauth/authorize');
    u.searchParams.set('client_id',clientId);
    u.searchParams.set('scope',scopes);
    u.searchParams.set('redirect_uri',redirectUri);
    u.searchParams.set('state',state);
    return res.redirect(302,u.toString());
  }catch(e){return res.status(500).send('Shopify認証を開始できません: '+e.message)}
}