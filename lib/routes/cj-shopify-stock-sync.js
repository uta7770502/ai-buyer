import { getShopifyAuthContext } from '../shopify-auth-context.js';
import { validateCJStockResponse } from '../cj-stock-validation.js';

const CJ_BASE='https://developers.cjdropshipping.com/api2.0/v1';
const API_VERSION='2026-10';
const TIMEOUT=10000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function cjToken(){
  if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
  const apiKey=String(process.env.CJ_API_KEY||'');
  if(!apiKey)throw Error('CJ_API_KEY is not configured');
  const r=await fetch(CJ_BASE+'/authentication/getAccessToken',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({apiKey}),signal:AbortSignal.timeout(TIMEOUT)
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error('CJ auth failed');
  return j.data.accessToken;
}

async function cjStock(vid,token){
  const u=new URL(CJ_BASE+'/product/stock/queryByVid');u.searchParams.set('vid',vid);
  const r=await fetch(u,{headers:{'CJ-Access-Token':token},signal:AbortSignal.timeout(TIMEOUT)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)return {ok:false,reason:'cj-http-error'};
  return validateCJStockResponse(j);
}

async function gql(endpoint,token,query,variables={}){
  const r=await fetch(endpoint,{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},
    body:JSON.stringify({query,variables}),
    signal:AbortSignal.timeout(TIMEOUT)
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.errors?.length)throw Error('Shopify GraphQL failed');
  return j.data;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
  if(!admin||req.headers?.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});

  const apply=req.method==='POST'&&String(req.query?.apply||'')==='true';
  if(apply&&process.env.CJ_SHOPIFY_STOCK_SYNC_ENABLED!=='true'){
    return res.status(409).json({ok:false,error:'Stock sync is disabled'});
  }

  const auth=await getShopifyAuthContext(req);
  if(!auth.ok)return res.status(auth.status).json({ok:false,error:auth.error});
  const endpoint='https://'+auth.shop+'/admin/api/'+API_VERSION+'/graphql.json';

  const productsQuery=`query DraftStockSyncProducts($first:Int!){
    products(first:$first,query:"status:draft AND (vendor:ODDLY OR vendor:\\"AI BUYER\\")"){
      nodes{
        id title status
        variants(first:20){
          nodes{
            id sku inventoryPolicy
            inventoryItem{
              id
              inventoryLevels(first:10){
                nodes{
                  location{id name}
                  quantities(names:["available"]){name quantity}
                }
              }
            }
          }
        }
      }
    }
  }`;
  const setMutation=`mutation SetInventory($input:InventorySetQuantitiesInput!){
    inventorySetQuantities(input:$input){
      inventoryAdjustmentGroup{createdAt reason}
      userErrors{field message}
    }
  }`;

  try{
    const data=await gql(endpoint,auth.token,productsQuery,{first:100});
    const products=Array.isArray(data?.products?.nodes)?data.products.nodes:[];
    const token=await cjToken();
    const rows=[];
    for(const p of products){
      for(const v of p.variants?.nodes||[]){
        const vid=String(v.sku||'').trim();
        if(!/^\d{10,25}$/.test(vid)){rows.push({productId:p.id,title:p.title,vid,ok:false,reason:'invalid-cj-vid'});continue}
        const stock=await cjStock(vid,token);
        if(!stock.ok){rows.push({productId:p.id,title:p.title,vid,ok:false,reason:'cj-stock-unavailable'});await sleep(650);continue}
        const levels=v.inventoryItem?.inventoryLevels?.nodes||[];
        if(levels.length!==1){
          rows.push({productId:p.id,title:p.title,vid,ok:false,cjStock:stock.total,reason:levels.length?'multiple-inventory-locations':'inventory-location-missing'});
          await sleep(650);continue;
        }
        const level=levels[0];
        const current=Number(level.quantities?.find(x=>x.name==='available')?.quantity||0);
        let applied=false,error=null;
        if(apply&&current!==stock.total){
          const input={
            name:'available',
            reason:'correction',
            referenceDocumentUri:'gid://oddly/CJStockSync/'+vid,
            quantities:[{
              inventoryItemId:v.inventoryItem.id,
              locationId:level.location.id,
              quantity:stock.total,
              changeFromQuantity:current
            }]
          };
          const out=await gql(endpoint,auth.token,setMutation,{input});
          const errors=out?.inventorySetQuantities?.userErrors||[];
          if(errors.length)error=errors.map(x=>x.message).join('; ');
          else applied=true;
        }
        rows.push({
          productId:p.id,title:p.title,vid,ok:!error,
          inventoryPolicy:v.inventoryPolicy,
          cjStock:stock.total,shopifyStock:current,
          location:level.location.name,
          changed:applied,error
        });
        await sleep(650);
      }
    }
    return res.status(200).json({
      ok:true,mode:apply?'apply':'dry-run',readOnly:!apply,
      checkedAt:new Date().toISOString(),
      products:products.length,variants:rows.length,
      inSync:rows.filter(x=>x.ok&&x.cjStock===x.shopifyStock).length,
      needsSync:rows.filter(x=>x.ok&&x.cjStock!==x.shopifyStock).length,
      changed:rows.filter(x=>x.changed).length,
      blocked:rows.filter(x=>!x.ok).length,
      rows
    });
  }catch{
    return res.status(503).json({ok:false,error:'CJ-Shopify stock sync failed'});
  }
}
