const VERSION='2026-10';
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables})});
  const j=await r.json();if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify API request failed');return j.data;
}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const c=cookies(req),token=String(c.shopify_access_token||''),shop=String(c.shopify_connected_shop||'');
    if(!token||!shop)return res.status(401).json({ok:false,authRequired:true,error:'Shopify認証が必要です'});
    const uri='https://ai-buyer-nine.vercel.app/api/shopify-order-webhook';
    const existing=await gql(shop,token,'query { webhookSubscriptions(first:50, topics:[ORDERS_PAID]) { nodes { id topic uri } } }');
    const found=(existing.webhookSubscriptions?.nodes||[]).find(x=>x.uri===uri);
    if(found)return res.status(200).json({ok:true,created:false,id:found.id,uri});
    const data=await gql(shop,token,'mutation Create($topic: WebhookSubscriptionTopic!, $input: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic:$topic, webhookSubscription:$input) { webhookSubscription { id topic uri } userErrors { field message } } }',{topic:'ORDERS_PAID',input:{uri}});
    const out=data.webhookSubscriptionCreate,errs=out?.userErrors||[];
    if(errs.length||!out?.webhookSubscription)throw Error(errs.map(x=>x.message).join(' / ')||'Webhook登録に失敗しました');
    return res.status(200).json({ok:true,created:true,id:out.webhookSubscription.id,uri});
  }catch(e){return res.status(500).json({ok:false,error:e.message||'自動発注Webhook設定に失敗しました'})}
}