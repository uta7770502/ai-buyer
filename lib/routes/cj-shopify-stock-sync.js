import { getShopifyAuthContext } from '../shopify-auth-context.js';
import { validateCJStockResponse } from '../cj-stock-validation.js';
import { summarizeStockAudit } from '../stock-audit-summary.js';

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
  if(r.status===429)return {ok:false,reason:'cj-rate-limited'};
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
  if(!r.ok||!j||typeof j!=='object'||Array.isArray(j)||
     (Object.hasOwn(j,'errors')&&(!Array.isArray(j.errors)||j.errors.length>0))||
     !j.data||typeof j.data!=='object'||Array.isArray(j.data)){
    throw Error('Shopify GraphQL failed');
  }
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
      pageInfo{hasNextPage}
      nodes{
        id title status vendor
        variants(first:20){
          pageInfo{hasNextPage}
          nodes{
            id sku inventoryPolicy
            inventoryItem{
              id
              inventoryLevels(first:10){
                pageInfo{hasNextPage}
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
    // All connection metadata must be present before reading supplier stock or mutating inventory.
    const incomplete=!Array.isArray(data?.products?.nodes)
      ||typeof data?.products?.pageInfo?.hasNextPage!=='boolean'
      ||data.products.pageInfo.hasNextPage
      ||products.length>=100
      ||products.some(p=>!p||!Array.isArray(p.variants?.nodes)||typeof p.variants?.pageInfo?.hasNextPage!=='boolean'
        ||p.variants.pageInfo.hasNextPage||p.variants.nodes.length>=20)
      ||products.some(p=>(p?.variants?.nodes||[]).some(v=>!v||!Array.isArray(v.inventoryItem?.inventoryLevels?.nodes)
        ||typeof v.inventoryItem.inventoryLevels.pageInfo?.hasNextPage!=='boolean'
        ||v.inventoryItem.inventoryLevels.pageInfo.hasNextPage));
    if(incomplete)return res.status(409).json({ok:false,readOnly:true,error:'Inventory audit incomplete: pagination required before stock sync'});
    if(products.some(p=>p.status!=='DRAFT'||!['ODDLY','AI BUYER'].includes(p.vendor))){
      return res.status(409).json({
        ok:false,readOnly:true,error:'Inventory audit contains unapproved products',
        blockedProducts:products.filter(p=>p.status!=='DRAFT'||!['ODDLY','AI BUYER'].includes(p.vendor)).length
      });
    }
    // Dry-run must reject the same ambiguous identifiers as apply.
    if(apply||products.length>0){
      const variants=products.flatMap(p=>p.variants.nodes);
      const vids=variants.map(v=>String(v.sku||'').trim());
      const inventoryIds=variants.map(v=>String(v.inventoryItem?.id||''));
      if(variants.length===0||new Set(vids).size!==vids.length||new Set(inventoryIds).size!==inventoryIds.length){
        return res.status(409).json({
          ok:false,readOnly:true,code:'DUPLICATE_OR_EMPTY_STOCK_IDENTIFIERS',
          error:'商品バリエーションがないか、在庫の識別番号が重複しています。商品のSKUと在庫設定を確認してください。'
        });
      }
    }
    if(apply){
      const invalidVariants=products.flatMap(p=>p.variants.nodes).filter(v=>
        !/^\d{10,25}$/.test(String(v.sku||'').trim())||v.inventoryPolicy!=='DENY');
      if(invalidVariants.length){
        return res.status(409).json({
          ok:false,readOnly:true,error:'Inventory audit contains unsafe variants',
          blockedVariants:invalidVariants.length
        });
      }
    }
    if(apply){
      const invalidTargets=products.flatMap(p=>p.variants.nodes).filter(v=>{
        const levels=v.inventoryItem?.inventoryLevels?.nodes;
        if(!Array.isArray(levels)||levels.length!==1)return true;
        const level=levels[0];
        const available=Array.isArray(level?.quantities)
          ?level.quantities.filter(x=>x?.name==='available'):[];
        return !/^gid:\/\/shopify\/InventoryItem\/[1-9]\d*$/.test(String(v.inventoryItem?.id||''))
          ||!/^gid:\/\/shopify\/Location\/[1-9]\d*$/.test(String(level?.location?.id||''))
          ||available.length!==1
          ||!Number.isSafeInteger(available[0]?.quantity)
          ||available[0].quantity<0;
      });
      if(invalidTargets.length){
        return res.status(409).json({
          ok:false,readOnly:true,error:'Inventory audit contains unverified inventory targets',
          blockedVariants:invalidTargets.length
        });
      }
    }
    if(products.length===0){
      return res.status(200).json({
        ok:true,mode:apply?'apply':'dry-run',readOnly:!apply,
        checkedAt:new Date().toISOString(),products:0,
        ...summarizeStockAudit([]),rows:[]
      });
    }
    const token=await cjToken();
    const rows=[];
    const pending=[];
    let cjRateLimited=false;
    for(const p of products){
      if(p.status!=='DRAFT'||!['ODDLY','AI BUYER'].includes(p.vendor)){
        for(const v of p.variants.nodes){
          rows.push({productId:p.id,title:p.title,vid:String(v.sku||'').trim(),ok:false,reason:'product-not-approved-draft'});
        }
        continue;
      }
      for(const v of p.variants?.nodes||[]){
        const vid=String(v.sku||'').trim();
        if(!/^\d{10,25}$/.test(vid)){rows.push({productId:p.id,title:p.title,vid,ok:false,reason:'invalid-cj-vid'});continue}
        if(v.inventoryPolicy!=='DENY'){
          rows.push({productId:p.id,title:p.title,vid,ok:false,reason:'inventory-policy-not-deny'});
          continue;
        }
        if(cjRateLimited){
          rows.push({productId:p.id,title:p.title,vid,ok:false,reason:'cj-rate-limit-skipped'});
          continue;
        }
        const stock=await cjStock(vid,token);
        if(!stock.ok){
          if(stock.reason==='cj-rate-limited')cjRateLimited=true;
          rows.push({productId:p.id,title:p.title,vid,ok:false,reason:stock.reason==='cj-rate-limited'?'cj-rate-limited':'cj-stock-unavailable'});
          if(!cjRateLimited)await sleep(1500);
          continue;
        }
        const levels=v.inventoryItem?.inventoryLevels?.nodes||[];
        if(levels.length!==1){
          rows.push({productId:p.id,title:p.title,vid,ok:false,cjStock:stock.total,reason:levels.length?'multiple-inventory-locations':'inventory-location-missing'});
          await sleep(1500);continue;
        }
        const level=levels[0];
        if(!/^gid:\/\/shopify\/InventoryItem\/[1-9]\d*$/.test(String(v.inventoryItem?.id||''))||
           !/^gid:\/\/shopify\/Location\/[1-9]\d*$/.test(String(level.location?.id||''))){
          rows.push({productId:p.id,title:p.title,vid,ok:false,reason:'inventory-target-unverified'});
          await sleep(1500);continue;
        }
        const available=Array.isArray(level.quantities)
          ?level.quantities.filter(x=>x?.name==='available'):[];
        if(available.length!==1){
          rows.push({productId:p.id,title:p.title,vid,ok:false,reason:'shopify-stock-unverified'});
          await sleep(1500);continue;
        }
        const rawCurrent=available[0].quantity;
        if(!Number.isSafeInteger(rawCurrent)||rawCurrent<0){
          rows.push({productId:p.id,title:p.title,vid,ok:false,reason:'shopify-stock-unverified'});
          await sleep(1500);continue;
        }
        const current=rawCurrent;
        const applied=false,error=null;
        if(current!==stock.total){
          pending.push({rowIndex:rows.length,quantity:{
            inventoryItemId:v.inventoryItem.id,
            locationId:level.location.id,
            quantity:stock.total,
            changeFromQuantity:current
          }});
        }
        rows.push({
          productId:p.id,title:p.title,vid,ok:!error,
          inventoryPolicy:v.inventoryPolicy,
          cjStock:stock.total,shopifyStock:current,
          location:level.location.name,
          changed:applied,error,
          effectiveShopifyStock:applied?stock.total:current
        });
        await sleep(1500);
      }
    }
    // Finish every supplier check before issuing any Shopify mutation.
    if(apply&&rows.some(row=>!row.ok)){
      return res.status(409).json({ok:false,mode:'apply',readOnly:true,
        error:'在庫を確認できない商品があるため、すべての在庫更新を中止しました。',
        ...summarizeStockAudit(rows),rows});
    }
    if(apply&&pending.length>250){
      return res.status(409).json({ok:false,readOnly:true,
        error:'一括更新の上限を超えたため、在庫は変更していません。',
        ...summarizeStockAudit(rows),rows});
    }
    if(apply&&pending.length){
      // One request, with compare-and-swap on every target. Never retry an ambiguous result.
      let error=null,unknown=false;
      try{
        const input={name:'available',reason:'correction',
          referenceDocumentUri:'gid://oddly/CJStockSync/'+Date.now(),
          quantities:pending.map(item=>item.quantity)};
        const out=await gql(endpoint,auth.token,setMutation,{input});
        const result=out?.inventorySetQuantities;
        const errors=result?.userErrors;
        if(Array.isArray(errors)&&errors.length){
          error=errors.map(x=>x?.message).filter(Boolean).join('; ')||'shopify-inventory-rejected';
        }else if(!result||!Array.isArray(errors)||!result.inventoryAdjustmentGroup?.createdAt){
          error='shopify-inventory-result-unverified';unknown=true;
        }
      }catch{error='shopify-inventory-result-unverified';unknown=true;}
      for(const item of pending){
        const row=rows[item.rowIndex];
        row.ok=!error;row.error=error;row.changed=!error;
        row.effectiveShopifyStock=error?row.shopifyStock:row.cjStock;
      }
      if(error)return res.status(503).json({ok:false,mode:'apply',readOnly:false,
        writeOutcome:unknown?'unknown':'rejected',retrySafe:false,
        error:unknown?'在庫更新の結果を確認できません。再実行せず、Shopifyの在庫を照合してください。':'Shopifyが在庫更新を受け付けませんでした。最新の在庫を再確認してください。',
        ...summarizeStockAudit(rows),rows});
    }
    return res.status(200).json({
      ok:rows.every(row=>row.ok),mode:apply?'apply':'dry-run',readOnly:!apply,
      checkedAt:new Date().toISOString(),
      products:products.length,
      ...summarizeStockAudit(rows),
      rows
    });
  }catch{
    return res.status(503).json({ok:false,readOnly:true,error:'在庫情報を取得できなかったため、在庫更新を中止しました。時間をおいて再確認してください。'});
  }
}
