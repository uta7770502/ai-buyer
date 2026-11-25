import { issueStockEvidence } from '../stock-audit-evidence.js';
import crypto from 'crypto';
import { getShopifyAuthContext } from '../shopify-auth-context.js';
import { validateCJStockResponse, classifyCJAvailability } from '../cj-stock-validation.js';
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
    // Shopify's raw error messages can include store-specific details.
    // Expose only a bounded, allowlisted diagnostic classification.
    const errors=Array.isArray(j?.errors)?j.errors:[];
    const codes=errors.map(e=>String(e?.extensions?.code||'').toUpperCase());
    const messages=errors.map(e=>String(e?.message||'').toLowerCase());
    const combined=messages.join(' ');
    const kind=codes.includes('ACCESS_DENIED')||/access denied|permission|scope/.test(combined)
      ?'ACCESS_DENIED'
      :codes.includes('GRAPHQL_VALIDATION_FAILED')||/doesn.t exist on type|cannot query field|unknown argument|variable .*invalid/.test(combined)
        ?'QUERY_VALIDATION'
        :r.status===429?'RATE_LIMITED'
          :r.status===401||r.status===403?'AUTHORIZATION'
            :r.status>=500?'SHOPIFY_UPSTREAM'
              :errors.length?'GRAPHQL_ERRORS':'INVALID_RESPONSE';
    throw Error('SHOPIFY_GRAPHQL_'+kind+'_HTTP_'+String(r.status));
  }
  return j.data;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
  if(!admin||req.headers?.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,readOnly:true,diagnosticStage:'admin-auth',diagnosticCode:'ADMIN_AUTH_REQUIRED',mutationPerformed:false,error:'管理者認証が必要です。ブラウザからの直接アクセスでは診断できません。'});

  const apply=req.method==='POST'&&String(req.query?.apply||'')==='true';
  if(apply&&process.env.CJ_SHOPIFY_STOCK_SYNC_ENABLED!=='true'){
    return res.status(409).json({ok:false,error:'Stock sync is disabled'});
  }

  const auth=await getShopifyAuthContext(req);
  if(!auth.ok)return res.status(auth.status).json({ok:false,error:auth.error});
  const endpoint='https://'+auth.shop+'/admin/api/'+API_VERSION+'/graphql.json';

  const productsQuery=`query DraftStockSyncProducts($first:Int!){
    products(first:$first,query:"status:draft"){
      pageInfo{hasNextPage}
      nodes{
        id title status vendor
        variants(first:20){
          pageInfo{hasNextPage}
          nodes{
            id sku inventoryPolicy inventoryQuantity
            inventoryItem{
              id tracked
              inventoryLevels(first:2){
                pageInfo{hasNextPage}
                nodes{location{id} quantities(names:["available"]){name quantity}}
              }
            }
          }
        }
      }
    }
  }`;
  const setMutation=`mutation SetInventory($input:InventorySetQuantitiesInput!,$idempotencyKey:String!){
    inventorySetQuantities(input:$input) @idempotent(key:$idempotencyKey){
      inventoryAdjustmentGroup{createdAt reason}
      userErrors{field message}
    }
  }`;

  let diagnosticStage='shopify-scopes';
  try{
    const scopeData=await gql(endpoint,auth.token,'query StockSyncScopes { currentAppInstallation { accessScopes { handle } } }');
    const scopes=(scopeData?.currentAppInstallation?.accessScopes||[]).map(x=>String(x?.handle||''));
    const requiredInventoryScopes=apply?['read_inventory','write_inventory']:['read_inventory'];
    const missingInventoryScopes=requiredInventoryScopes.filter(x=>!scopes.includes(x));
    if(missingInventoryScopes.length){
      return res.status(409).json({
        ok:false,readOnly:true,
        diagnosticStage:'shopify-scopes',
        diagnosticCode:'SHOPIFY_INVENTORY_SCOPES_MISSING',
        missingScopes:missingInventoryScopes,
        reconnectRequired:true,
        mutationPerformed:false,
        error:'Shopifyの在庫権限が不足しています。ADPSをShopifyに再接続してください。'
      });
    }
    diagnosticStage='shopify-products';
    const data=await gql(endpoint,auth.token,productsQuery,{first:100});
    const fetchedProducts=Array.isArray(data?.products?.nodes)?data.products.nodes:[];
    const products=fetchedProducts.filter(p=>p?.status==='DRAFT'&&['ODDLY','AI BUYER'].includes(String(p?.vendor||'')));
    // All connection metadata must be present before reading supplier stock or mutating inventory.
    const incomplete=!Array.isArray(data?.products?.nodes)
      ||typeof data?.products?.pageInfo?.hasNextPage!=='boolean'
      ||data.products.pageInfo.hasNextPage
      ||fetchedProducts.length>=100
      ||products.some(p=>!p||!Array.isArray(p.variants?.nodes)||typeof p.variants?.pageInfo?.hasNextPage!=='boolean'
        ||p.variants.pageInfo.hasNextPage||p.variants.nodes.length>=20)
      ||products.some(p=>(p?.variants?.nodes||[]).some(v=>!v||!Array.isArray(v.inventoryItem?.inventoryLevels?.nodes)
        ||typeof v.inventoryItem.inventoryLevels.pageInfo?.hasNextPage!=='boolean'
        ||v.inventoryItem.inventoryLevels.pageInfo.hasNextPage));
    if(incomplete)return res.status(409).json({ok:false,readOnly:true,error:'Inventory audit incomplete: pagination required before stock sync'});
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
    const untrackedVariants=products.flatMap(p=>p.variants.nodes).filter(v=>v.inventoryItem?.tracked!==true);
    if(untrackedVariants.length){
      return res.status(409).json({
        ok:false,readOnly:true,code:'INVENTORY_TRACKING_REQUIRED',
        blockedVariants:untrackedVariants.length,
        error:'在庫追跡が無効、または確認できない商品があります。Shopifyで在庫追跡を有効にしてから再診断してください。'
      });
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
    // Compare-and-swap requires the exact location's "available" quantity,
    // not the variant-wide inventoryQuantity. Keep writes disabled until
    // the location-specific audit is implemented and verified end to end.
    if(apply){
      return res.status(409).json({
        ok:false,mode:'apply',readOnly:true,mutationPerformed:false,
        code:'LOCATION_AVAILABLE_QUANTITY_UNVERIFIED',
        error:'Shopifyのロケーション別available在庫が未検証のため、在庫更新を安全停止しました。読み取り専用の監査は引き続き利用できます。'
      });
    }
    if(apply){
      const invalidTargets=products.flatMap(p=>p.variants.nodes).filter(v=>{
        const levels=v.inventoryItem?.inventoryLevels?.nodes;
        if(!Array.isArray(levels)||levels.length!==1)return true;
        const level=levels[0];
        return !/^gid:\/\/shopify\/InventoryItem\/[1-9]\d*$/.test(String(v.inventoryItem?.id||''))
          ||!/^gid:\/\/shopify\/Location\/[1-9]\d*$/.test(String(level?.location?.id||''))
          ||!Array.isArray(level?.quantities)
          ||level.quantities.filter(x=>x?.name==='available').length!==1
          ||!Number.isSafeInteger(level.quantities.find(x=>x?.name==='available')?.quantity)
          ||level.quantities.find(x=>x?.name==='available').quantity<0;
      });
      if(invalidTargets.length){
        return res.status(409).json({
          ok:false,readOnly:true,error:'Inventory audit contains unverified inventory targets',
          blockedVariants:invalidTargets.length
        });
      }
    }
    if(products.length===0){
      if(apply)return res.status(409).json({ok:false,mode:'apply',readOnly:true,code:'NO_DRAFT_PRODUCTS',error:'同期対象の下書き商品が0件のため、在庫更新は実行しません。'});
      return res.status(200).json({
        ok:true,mode:apply?'apply':'dry-run',readOnly:!apply,
        checkedAt:new Date().toISOString(),products:0,
        ...summarizeStockAudit([]),rows:[]
      });
    }
    diagnosticStage='cj-auth';
    const token=await cjToken();
    diagnosticStage='cj-stock';
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
        const availability=classifyCJAvailability(stock);
        const levels=v.inventoryItem?.inventoryLevels?.nodes||[];
        if(levels.length!==1){
          rows.push({productId:p.id,title:p.title,vid,ok:false,cjStock:stock.total,factoryStock:stock.factoryTotal,stockSource:availability.reason,recommendationEligible:availability.recommendationEligible,requiresFactoryReplenishment:availability.requiresFactoryReplenishment,reason:levels.length?'multiple-inventory-locations':'inventory-location-missing'});
          await sleep(1500);continue;
        }
        const level=levels[0];
        if(!/^gid:\/\/shopify\/InventoryItem\/[1-9]\d*$/.test(String(v.inventoryItem?.id||''))||
           !/^gid:\/\/shopify\/Location\/[1-9]\d*$/.test(String(level.location?.id||''))){
          rows.push({productId:p.id,title:p.title,vid,ok:false,reason:'inventory-target-unverified'});
          await sleep(1500);continue;
        }
        const available=Array.isArray(level.quantities)
          ?level.quantities.filter(x=>x?.name==='available'):null;
        const rawCurrent=available?.length===1?available[0]?.quantity:null;
        const current=rawCurrent;
        if(!Number.isSafeInteger(rawCurrent)||rawCurrent<0){
          rows.push({productId:p.id,title:p.title,vid,ok:false,reason:'shopify-stock-unverified'});
          await sleep(1500);continue;
        }
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
          cjStock:stock.total,factoryStock:stock.factoryTotal,
          stockSource:availability.reason,
          recommendationEligible:availability.recommendationEligible,
          factoryReplenishmentRequired:availability.requiresFactoryReplenishment,
          shopifyStock:current,
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
    // The preview plan mirrors the actual CAS input but is never submitted.
    // Shopify Int quantities are bounded to signed 32-bit values.
    const planReady=!apply&&rows.length>0&&rows.length===products.reduce((n,p)=>n+p.variants.nodes.length,0)&&rows.every(row=>row.ok===true&&Number.isSafeInteger(row.cjStock)&&row.cjStock>=0&&row.cjStock<=2147483647&&Number.isSafeInteger(row.shopifyStock)&&row.shopifyStock>=0&&row.shopifyStock<=2147483647)&&pending.length<=250;
    const syncPlan={
      ready:planReady,
      mode:'read-only-cas-preview',
      mutationPerformed:false,
      writeLocked:true,
      factoryStockIncluded:false,
      changeCount:planReady?pending.length:0,
      quantities:planReady?pending.map(item=>item.quantity):[]
    };
    diagnosticStage='shopify-inventory-write';
    if(apply&&pending.length){
      // One request, with compare-and-swap on every target. Never retry an ambiguous result.
      let error=null,unknown=false;
      try{
        const input={name:'available',reason:'correction',
          referenceDocumentUri:'gid://oddly/CJStockSync/'+Date.now(),
          quantities:pending.map(item=>item.quantity)};
        const out=await gql(endpoint,auth.token,setMutation,{input,idempotencyKey:crypto.randomUUID()});
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
      syncPlan,
      stockEvidence:!apply&&rows.length===products.reduce((n,p)=>n+p.variants.nodes.length,0)?issueStockEvidence(rows.map(row=>({sku:row.vid,ok:row.ok,cjStockVerified:row.ok===true,cjStockQuantity:row.cjStock,factoryStockQuantity:row.factoryStock}))):null,
      rows
    });
  }catch(e){
    const safeMessage=String(e?.message||'').slice(0,120);
    // Isolate the failing Shopify selection without exposing products or credentials.
    // Probes run only for authenticated read-only requests, never for apply.
    const productQueryProbes=[];
    if(diagnosticStage==='shopify-products'&&!apply){
      const probes=[
        ['products-basic','query { products(first:1,query:"status:draft"){nodes{id status vendor}} }'],
        ['variants-basic','query { products(first:1,query:"status:draft"){nodes{variants(first:1){nodes{id sku inventoryPolicy inventoryQuantity}}}} }'],
        ['inventory-item','query { products(first:1,query:"status:draft"){nodes{variants(first:1){nodes{inventoryItem{id tracked}}}}} }'],
        ['inventory-levels-id','query { products(first:1,query:"status:draft"){nodes{variants(first:1){nodes{inventoryItem{inventoryLevels(first:1){nodes{id}}}}}}} }'],
        ['inventory-location-id','query { products(first:1,query:"status:draft"){nodes{variants(first:1){nodes{inventoryItem{inventoryLevels(first:1){nodes{location{id}}}}}}}} }'],
        ['inventory-available','query { products(first:1,query:"status:draft"){nodes{variants(first:1){nodes{inventoryItem{inventoryLevels(first:1){nodes{quantities(names:["available"]){name quantity}}}}}}}} }']
      ];
      for(const [name,query] of probes){
        try{
          await gql(endpoint,auth.token,query);
          productQueryProbes.push({name,ok:true});
        }catch(probeError){
          productQueryProbes.push({name,ok:false,code:String(probeError?.message||'UNKNOWN').slice(0,100)});
          break;
        }
      }
    }
    return res.status(503).json({
      ok:false,readOnly:true,
      error:'在庫情報を取得できなかったため、在庫更新を中止しました。',
      diagnosticStage,
      diagnosticCode:
        diagnosticStage==='shopify-products'?'SHOPIFY_PRODUCT_QUERY_FAILED':
        diagnosticStage==='cj-auth'?'CJ_AUTH_FAILED':
        diagnosticStage==='cj-stock'?'CJ_STOCK_AUDIT_FAILED':
        diagnosticStage==='shopify-inventory-write'?'SHOPIFY_INVENTORY_WRITE_FAILED':
        'STOCK_SYNC_FAILED',
      detail:safeMessage||null,
      ...(productQueryProbes.length?{productQueryProbes}:{}),
      mutationPerformed:false
    });
  }
}
