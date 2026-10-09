const VERSION='2026-10';

function cookies(req){
  return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{
    const i=v.indexOf('=');
    return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))];
  }));
}
async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},
    body:JSON.stringify({query,variables}),
    signal:AbortSignal.timeout(10000)
  });
  const j=await r.json();
  if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify API request failed');
  return j.data;
}
function str(v,n=200){return String(v??'').trim().slice(0,n)}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=process.env.AI_BUYER_ADMIN_KEY;
  if(!admin||req.headers.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  try{
    const c=cookies(req),token=String(c.shopify_access_token||''),shop=String(c.shopify_connected_shop||'').toLowerCase();
    if(!token||!shop)return res.status(401).json({ok:false,authRequired:true,error:'Shopify authentication required'});
    const allowed=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
    if(!allowed||shop!==allowed)return res.status(403).json({ok:false,error:'Shopify shop is not authorized'});
    const orderId=str(req.body?.orderId,80);
    const trackingNumber=str(req.body?.trackingNumber,200);
    const trackingCompany=str(req.body?.trackingCompany,100);
    const trackingUrl=str(req.body?.trackingUrl,500);
    if(!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId))return res.status(400).json({ok:false,error:'Valid Shopify order GID is required'});
    if(!trackingNumber)return res.status(400).json({ok:false,error:'trackingNumber is required'});
    const data=await gql(shop,token,`query($id:ID!){ order(id:$id){ id fulfillmentOrders(first:20){nodes{id status requestStatus supportedActions{action}}} } }`,{id:orderId});
    const nodes=data.order?.fulfillmentOrders?.nodes||[];
    const target=nodes.find(x=>x.status==='OPEN'||x.status==='IN_PROGRESS'||x.status==='SCHEDULED');
    if(!target)return res.status(409).json({ok:false,error:'No fulfillable Shopify fulfillment order found'});
    const input={
      lineItemsByFulfillmentOrder:[{fulfillmentOrderId:target.id}],
      notifyCustomer:false,
      trackingInfo:{
        number:trackingNumber,
        company:trackingCompany||undefined,
        url:trackingUrl||undefined
      }
    };
    const out=await gql(shop,token,`mutation($fulfillment:FulfillmentV2Input!){ fulfillmentCreateV2(fulfillment:$fulfillment){ fulfillment{id status trackingInfo{number company url}} userErrors{field message}} }`,{fulfillment:input});
    const result=out.fulfillmentCreateV2,errs=result?.userErrors||[];
    if(errs.length||!result?.fulfillment)return res.status(422).json({ok:false,error:errs.map(x=>x.message).join(' / ')||'Shopify fulfillment creation failed'});
    return res.status(200).json({ok:true,fulfillmentId:result.fulfillment.id,status:result.fulfillment.status,trackingInfo:result.fulfillment.trackingInfo,customerNotified:false});
  }catch(e){
    return res.status(500).json({ok:false,error:e.message||'Unable to create Shopify fulfillment'});
  }
}
