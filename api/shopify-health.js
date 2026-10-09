const VERSION='2026-10';
function config(){
  const shop=String(process.env.SHOPIFY_STORE_DOMAIN||'').trim().replace(/^https?:\/\//,'').replace(/\/$/,'');
  const token=String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||'').trim();
  return {shop,token};
}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const {shop,token}=config();
  if(!shop||!token)return res.status(200).json({ok:false,configured:false,error:'Shopify未接続'});
  try{
    const started=Date.now();
    const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},
      body:JSON.stringify({query:'query { shop { name myshopifyDomain } }'})
    });
    const j=await r.json();
    if(!r.ok||j.errors||!j.data?.shop)throw Error(j.errors?.[0]?.message||'Shopify接続に失敗しました');
    return res.status(200).json({ok:true,configured:true,shop:j.data.shop.name,domain:j.data.shop.myshopifyDomain,latencyMs:Date.now()-started,checkedAt:new Date().toISOString()});
  }catch(e){return res.status(502).json({ok:false,configured:true,error:e.message||'Shopify接続に失敗しました'})}
}