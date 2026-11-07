import automationHealth from '../lib/routes/automation-health.js';
import automationOrderStatus from '../lib/routes/automation-order-status.js';
import automationReconciliation from '../lib/routes/automation-reconciliation.js';
import cjHealth from '../lib/routes/cj-health.js';
import cjFreight from '../lib/routes/cj-freight.js';
import cjShopifyStockSync from '../lib/routes/cj-shopify-stock-sync.js';
import { validateCJStockResponse } from '../lib/cj-stock-validation.js';
import shopifyFulfillmentSync from '../lib/routes/shopify-fulfillment-sync.js';
import releaseReadiness from '../lib/routes/release-readiness.js';
import shopifySandboxOrder from '../lib/routes/shopify-sandbox-order.js';
import storefrontCheckout from '../lib/routes/storefront-checkout.js';
import storefrontConfig from '../lib/routes/storefront-config.js';
import prelaunchProductAudit from '../lib/routes/prelaunch-product-audit.js';
import prelaunchOneAction from '../lib/routes/prelaunch-one-action.js';
import previewProfitAudit from '../lib/routes/preview-profit-audit.js';

const PREVIEW_MANAGED_CJ_VIDS=[
  '1421057421656330240','1657322876615274496','1641339380621119488',
  '1637037130838978560','1380443011925807104','1443515898471256064',
  '2408310600381614000','1416372414316679168','1763801727867822080'
];

function normalizeShopHost(v){return String(v||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'')}
function shopifyEnvCheck(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const rawShop=normalizeShopHost(process.env.SHOPIFY_SHOP);
  const rawAllowed=normalizeShopHost(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN);
  const shop=rawShop.replace(/\.myshopify\.com$/i,'');
  const expected=shop?shop+'.myshopify.com':'';
  const validShop=/^[a-z0-9][a-z0-9-]*$/.test(shop);
  const validAllowed=/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(rawAllowed);
  return res.status(200).json({ok:true,shopConfigured:Boolean(rawShop),allowedConfigured:Boolean(rawAllowed),normalizedShop:shop,expectedAllowedDomain:expected,normalizedAllowedDomain:rawAllowed,validShop,validAllowed,matches:Boolean(validShop&&validAllowed&&expected===rawAllowed)});
}

async function previewPrelaunchSummary(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const allowed=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='safety-gate-20261024';
  if(!allowed)return res.status(404).json({ok:false});
  const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
  if(!admin)return res.status(503).json({ok:false,error:'Preview admin key missing'});
  const capture={code:200,status(n){this.code=n;return this},setHeader(){return this},json(v){this.body=v;return this},send(v){this.body=v;return this},end(){return this}};
  await prelaunchOneAction({method:'POST',headers:{authorization:'Bearer '+admin},query:{},body:{}},capture);
  const b=capture.body||{};
  return res.status(capture.code===200?200:503).json({
    ok:capture.code===200&&b.ok===true,
    readyToFinalManualStep:Boolean(b.readyToFinalManualStep),
    checkedAt:b.checkedAt||new Date().toISOString(),
    checks:b.checks||{},
    blockers:Array.isArray(b.blockers)?b.blockers.slice(0,20):[],
    warnings:Array.isArray(b.warnings)?b.warnings.slice(0,20):[],
    productAudit:{
      draftCount:Number(b.productAudit?.draftCount||0),
      readyDrafts:Number(b.productAudit?.readyDrafts||0),
      blockedDrafts:Number(b.productAudit?.blockedDrafts||0),
      totalIssues:Number(b.productAudit?.totalIssues||0),
      nonDraftCount:Number(b.productAudit?.nonDraftCount||0),
      issueSummary:Array.isArray(b.productAudit?.issueSummary)?b.productAudit.issueSummary:[]
    },
    reconciliation:b.reconciliation?{total:Number(b.reconciliation.total||0),partial:Boolean(b.reconciliation.partial)}:null
  });
}

async function previewCjDraftAudit(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const allowed=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='safety-gate-20261024';
  if(!allowed)return res.status(404).json({ok:false});
  const vids=PREVIEW_MANAGED_CJ_VIDS;
  const rows=[];
  for(const vid of vids){
    const cap={code:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(v){this.body=v;return this},send(v){this.body=v;return this},end(){return this}};
    await cjFreight({method:'GET',headers:{},query:{vid,destination:'JP'}},cap);
    const b=cap.body||{};
    rows.push({
      vid,
      ok:cap.code===200&&b.ok===true,
      shippingJpy:Number.isFinite(Number(b.shippingCostJpy))?Number(b.shippingCostJpy):null,
      shippingVerified:b.shippingJpyVerified===true,
      optionCount:Array.isArray(b.options)?b.options.length:0,
      error:cap.code===200&&b.ok===true?null:String(b.code||b.error||'CJ lookup failed').slice(0,120)
    });
  }
  return res.status(200).json({
    ok:true,readOnly:true,checkedAt:new Date().toISOString(),
    total:rows.length,passed:rows.filter(x=>x.ok).length,failed:rows.filter(x=>!x.ok).length,
    rows
  });
}

async function previewCjStockAudit(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const allowed=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='safety-gate-20261024';
  if(!allowed)return res.status(404).json({ok:false});
  const vids=PREVIEW_MANAGED_CJ_VIDS;
  const BASE='https://developers.cjdropshipping.com/api2.0/v1';
  async function token(){
    if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
    const rr=await fetch(BASE+'/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:process.env.CJ_API_KEY}),signal:AbortSignal.timeout(10000)});
    const jj=await rr.json();if(!rr.ok||jj.result!==true||!jj.data?.accessToken)throw Error('CJ auth failed');return jj.data.accessToken;
  }
  try{
    const t=await token(),rows=[];
    for(const vid of vids){
      const u=new URL(BASE+'/product/stock/queryByVid');u.searchParams.set('vid',vid);
      const rr=await fetch(u,{headers:{'CJ-Access-Token':t},signal:AbortSignal.timeout(10000)});
      const jj=await rr.json().catch(()=>({}));
      const valid=rr.ok?validateCJStockResponse(jj):{ok:false,reason:'cj-http-error'};
      const total=valid.ok?valid.total:null;
      const available=valid.ok&&total>0;
      const dataShape=Array.isArray(jj.data)?'array':jj.data===null?'null':typeof jj.data;
      const warehouseFlagValues=Array.isArray(jj.data)
        ?[...new Set(jj.data.map(x=>x?.verifiedWarehouse===undefined?'missing':String(x.verifiedWarehouse)))].slice(0,5)
        :[];
      rows.push({
        vid,ok:valid.ok,reason:valid.ok?null:valid.reason,
        status:!valid.ok?'unverified':available?'available':'out-of-stock',
        warehouseRowCount:Array.isArray(jj.data)?jj.data.length:0,totalInventory:total,
        diagnostic:valid.ok?null:{
          httpStatus:rr.status,
          cjResult:jj.result===true?'true':jj.result===false?'false':'missing',
          cjCode:typeof jj.code==='number'||typeof jj.code==='string'?String(jj.code).slice(0,32):null,
          dataShape,warehouseRows:Array.isArray(jj.data)?jj.data.length:null,
          warehouseFlagValues,
          // queryByVid stock rows do not expose verifiedWarehouse. Report quantities
          // separately without treating them as publication-approved inventory.
          cjManagedInventory:Array.isArray(jj.data)&&jj.data.every(x=>Number.isSafeInteger(x?.cjInventoryNum)&&x.cjInventoryNum>=0)
            ?jj.data.reduce((sum,x)=>sum+x.cjInventoryNum,0):null,
          factoryInventory:Array.isArray(jj.data)&&jj.data.every(x=>Number.isSafeInteger(x?.factoryInventoryNum)&&x.factoryInventoryNum>=0)
            ?jj.data.reduce((sum,x)=>sum+x.factoryInventoryNum,0):null,
          inventorySchema:'stock-query-by-vid'
        },
        available
      });
      // Do not continue hitting CJ after a rate-limit response. Remaining SKUs stay unverified.
      if(rr.status===429){
        for(const remaining of vids.slice(rows.length)){
          rows.push({vid:remaining,ok:false,reason:'cj-rate-limit-skipped',status:'unverified',warehouseRowCount:0,totalInventory:null,diagnostic:{httpStatus:null,cjResult:'not-requested',cjCode:null,dataShape:'not-requested',warehouseRows:null,warehouseFlagValues:[]},available:false});
        }
        break;
      }
      await new Promise(r=>setTimeout(r,1500));
    }
    const launchEligible=rows.filter(x=>x.ok&&Number.isSafeInteger(x.totalInventory)&&x.totalInventory>=5).length;
    for(const row of rows)row.launchEligible=row.ok&&Number.isSafeInteger(row.totalInventory)&&row.totalInventory>=5;
    return res.status(200).json({ok:true,readOnly:true,total:rows.length,available:rows.filter(x=>x.status==='available').length,unavailable:rows.filter(x=>x.status==='out-of-stock').length,unverified:rows.filter(x=>x.status==='unverified').length,launchEligible,minimumLaunchInventory:5,allVerified:rows.every(x=>x.ok),rows});
  }catch(e){return res.status(503).json({ok:false,error:'CJ stock audit failed'})}
}

async function previewLaunchAuditSummary(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const allowed=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='safety-gate-20261024';
  if(!allowed)return res.status(404).json({ok:false});
  const capture=()=>({code:200,status(n){this.code=n;return this},setHeader(){return this},json(v){this.body=v;return this},send(v){this.body=v;return this},end(){return this}});
  const freight=capture(),stock=capture(),profit=capture(),prelaunch=capture();
  // Run supplier-backed checks sequentially. CJ enforces a strict request rate and
  // concurrent stock/profit audits can otherwise rate-limit each other.
  await previewPrelaunchSummary({method:'GET',headers:{},query:{}},prelaunch);
  await new Promise(r=>setTimeout(r,1500));
  await previewCjDraftAudit({method:'GET',headers:{},query:{}},freight);
  await new Promise(r=>setTimeout(r,1500));
  await previewCjStockAudit({method:'GET',headers:{},query:{}},stock);
  await new Promise(r=>setTimeout(r,1500));
  await previewProfitAudit({method:'GET',headers:{},query:{}},profit);
  const f=freight.body||{},s=stock.body||{},p=profit.body||{},q=prelaunch.body||{};
  const expectedSkus=PREVIEW_MANAGED_CJ_VIDS;
  const freightRows=Array.isArray(f.rows)?f.rows:[];
  const stockRows=Array.isArray(s.rows)?s.rows:[];
  const profitRows=Array.isArray(p.rows)?p.rows:[];
  const freightSeen=new Set(freightRows.map(x=>String(x?.vid||'')));
  const stockSeen=new Set(stockRows.map(x=>String(x?.vid||'')));
  const profitSeen=new Set(profitRows.map(x=>String(x?.sku||'')));
  const missingSkus=expectedSkus.filter(vid=>!freightSeen.has(vid)||!stockSeen.has(vid)||!profitSeen.has(vid));
  const duplicateSkus={
    freight:freightRows.length-freightSeen.size,
    stock:stockRows.length-stockSeen.size,
    profit:profitRows.length-profitSeen.size
  };
  const unexpectedSkus=[...new Set([
    ...freightRows.map(x=>String(x?.vid||'')),
    ...stockRows.map(x=>String(x?.vid||'')),
    ...profitRows.map(x=>String(x?.sku||''))
  ].filter(Boolean).filter(vid=>!expectedSkus.includes(vid)))];
  const freightOk=new Set(freightRows.filter(x=>x?.ok===true&&x?.shippingVerified===true).map(x=>String(x.vid||'')));
  const stockOk=new Set(stockRows.filter(x=>x?.launchEligible===true).map(x=>String(x.vid||'')));
  const profitOk=new Set(profitRows.filter(x=>x?.launchEconomicsEligible===true).map(x=>String(x.sku||'')));
  const launchCandidateSkus=[...stockOk].filter(vid=>vid&&freightOk.has(vid)&&profitOk.has(vid));
  const skuMatrix=expectedSkus.map(vid=>{
    const freightRow=freightRows.find(x=>String(x?.vid||'')===vid)||null;
    const stockRow=stockRows.find(x=>String(x?.vid||'')===vid)||null;
    const profitRow=profitRows.find(x=>String(x?.sku||'')===vid)||null;
    const freightPass=Boolean(freightRow?.ok===true&&freightRow?.shippingVerified===true);
    const stockPass=Boolean(stockRow?.launchEligible===true);
    const profitPass=Boolean(profitRow?.launchEconomicsEligible===true);
    const reasons=[];
    if(!freightPass)reasons.push('送料未確認');
    if(!stockPass)reasons.push('在庫5未満または未確認');
    if(!profitPass)reasons.push('最終利益条件未達');
    return {sku:vid,freightPass,stockPass,profitPass,launchCandidate:freightPass&&stockPass&&profitPass,reasons};
  });
  // Every existing SKU remains visible, including unavailable inventory; never auto-publish.
  const catalogTriage=expectedSkus.map(vid=>{
    const stockRow=stockRows.find(x=>String(x?.vid||'')===vid);
    const profitRow=profitRows.find(x=>String(x?.sku||'')===vid);
    const freightRow=freightRows.find(x=>String(x?.vid||'')===vid);
    const stockEligible=stockRow?.launchEligible===true;
    const freightVerified=freightRow?.ok===true&&freightRow?.shippingVerified===true;
    const margin=profitRow?.ok===true?Number(profitRow.contributionMarginPercent):null;
    const marginVerified=margin!==null&&Number.isFinite(margin);
    const status=!stockEligible?'inventory_hold':!freightVerified?'freight_hold':!marginVerified?'cost_verification':margin<25?'margin_reprice':profitRow?.assumptionsReady!==true?'cost_assumptions_required':profitRow?.launchEconomicsEligible===true?'economics_pass':'final_profit_review';
    return {sku:vid,status,stockEligible,freightVerified,contributionMarginPercent:marginVerified?margin:null,
      targetMargin30Pass:marginVerified&&margin>=30,
      nextAction:status==='inventory_hold'?'monitor_inventory_and_find_replacement':status==='freight_hold'?'verify_japan_shipping':status==='cost_verification'?'verify_cj_cost':status==='margin_reprice'?'review_price_or_supplier':status==='cost_assumptions_required'?'set_verified_ad_and_return_costs':status==='final_profit_review'?'review_final_profit':'complete_prelaunch_safety_checks'};
  });
  const skuSummary={
    total:skuMatrix.length,
    launchCandidates:skuMatrix.filter(x=>x.launchCandidate).length,
    freightBlocked:skuMatrix.filter(x=>!x.freightPass).length,
    stockBlocked:skuMatrix.filter(x=>!x.stockPass).length,
    profitBlocked:skuMatrix.filter(x=>!x.profitPass).length
  };
  const profitDiagnosis={
    verified:profitRows.filter(x=>x?.ok===true).length,
    assumptionsMissing:profitRows.filter(x=>x?.ok===true&&x.assumptionsReady!==true).length,
    belowContributionFloor:profitRows.filter(x=>x?.ok===true&&Number.isFinite(x.contributionMarginPercent)&&x.contributionMarginPercent<25).length,
    finalProfitNonPositive:profitRows.filter(x=>x?.ok===true&&x.assumptionsReady===true&&Number.isFinite(x.finalProfitJpy)&&x.finalProfitJpy<=0).length,
    eligible:profitRows.filter(x=>x?.launchEconomicsEligible===true).length
  };
  // Read-only 30% scenario; do not change the active 25% launch gate.
  const margin30Scenario={
    minimumContributionMarginPercent:30,
    verified:profitRows.filter(x=>x?.ok===true&&Number.isFinite(x.contributionMarginPercent)).length,
    marginPass:profitRows.filter(x=>x?.ok===true&&Number.isFinite(x.contributionMarginPercent)&&x.contributionMarginPercent>=30).length,
    stockAndMarginPass:profitRows.filter(x=>x?.ok===true&&Number.isFinite(x.contributionMarginPercent)&&x.contributionMarginPercent>=30&&stockOk.has(String(x.sku||''))&&freightOk.has(String(x.sku||''))).length,
    finalProfitReady:profitRows.filter(x=>x?.ok===true&&x.assumptionsReady===true&&Number.isFinite(x.finalProfitJpy)&&x.finalProfitJpy>0&&x.contributionMarginPercent>=30&&stockOk.has(String(x.sku||''))&&freightOk.has(String(x.sku||''))).length,
    assumptionsMissing:profitRows.filter(x=>x?.ok===true&&x.assumptionsReady!==true).length
  };
  // Budget guidance is read-only and does not fabricate missing ad or return assumptions.
  const profitBudgetCandidates=profitRows.filter(x=>x?.ok===true&&stockOk.has(String(x.sku||''))&&freightOk.has(String(x.sku||''))).map(x=>({
    sku:String(x.sku||''),
    contributionMarginPercent:Number(x.contributionMarginPercent),
    targetMargin30Pass:Number(x.contributionMarginPercent)>=30,
    candidateTier:Number(x.contributionMarginPercent)>=30?'priority':Number(x.contributionMarginPercent)>=25?'conditional':'excluded',
    maxCombinedAdsReturnsForPositiveProfitJpy:Number(x.maxCombinedAdsReturnsForPositiveProfitJpy),
    maxCombinedAdsReturnsForFivePercentNetJpy:Number(x.maxCombinedAdsReturnsForFivePercentNetJpy),
    assumptionsReady:x.assumptionsReady===true,
    requiredCostMetafieldsMissing:[...(x.plannedAdCostPerOrderJpy===null?['custom.ad_cost_per_order_jpy']:[]),...(x.returnReservePerOrderJpy===null?['custom.return_reserve_per_order_jpy']:[])],
    saleReady:x.assumptionsReady===true&&Number(x.finalProfitJpy)>0&&Number(x.contributionMarginPercent)>=25,
    readinessBlockers:[
      ...(Number(x.contributionMarginPercent)<25?['CONTRIBUTION_MARGIN_BELOW_25_PERCENT']:[]),
      ...(x.plannedAdCostPerOrderJpy===null?['AD_COST_UNSET']:[]),
      ...(x.returnReservePerOrderJpy===null?['RETURN_RESERVE_UNSET']:[]),
      ...(x.assumptionsReady===true&&!(Number(x.finalProfitJpy)>0)?['FINAL_PROFIT_NOT_POSITIVE']:[])
    ],
    // Hypothetical combined per-order ads + returns; never stored or treated as verified.
    hypotheticalCombinedCostScenariosJpy:[100,200,300].map(combinedCostJpy=>({
      combinedCostJpy,
      estimatedNetProfitJpy:Number(x.contributionBeforeAdsJpy)-combinedCostJpy,
      fivePercentNetTargetPass:combinedCostJpy<=Number(x.maxCombinedAdsReturnsForFivePercentNetJpy),
      positiveNetPass:Number(x.contributionBeforeAdsJpy)>combinedCostJpy
    }))
  }));
  const nextActions=[];
  if(missingSkus.length||unexpectedSkus.length||duplicateSkus.freight||duplicateSkus.stock||duplicateSkus.profit)nextActions.push('監査対象SKUの不整合を解消');
  if(skuSummary.freightBlocked>0)nextActions.push('送料未確認SKUを再取得');
  if(skuSummary.stockBlocked>0)nextActions.push('在庫5未満SKUを販売候補から外し代替候補を補充');
  if(profitDiagnosis.assumptionsMissing>0)nextActions.push('広告費・返品引当の未設定を確認');
  if(profitDiagnosis.belowContributionFloor>0)nextActions.push('限界利益率25%未満SKUの価格・仕入原価を見直す');
  if(profitDiagnosis.finalProfitNonPositive>0)nextActions.push('最終利益が黒字でないSKUの広告費・価格を見直す');
  if(skuSummary.profitBlocked>0&&profitDiagnosis.assumptionsMissing===0&&profitDiagnosis.belowContributionFloor===0&&profitDiagnosis.finalProfitNonPositive===0)nextActions.push('最終利益条件未達SKUを価格調整または候補除外');
  if(!q.readyToFinalManualStep)nextActions.push('公開前監査blockersを解消');
  if(nextActions.length===0)nextActions.push('最終手動承認待ち');
  const checks={
    catalogCoverageComplete:missingSkus.length===0&&unexpectedSkus.length===0&&duplicateSkus.freight===0&&duplicateSkus.stock===0&&duplicateSkus.profit===0&&freightRows.length===expectedSkus.length&&stockRows.length===expectedSkus.length&&profitRows.length===expectedSkus.length,
    freightVerified:freight.code===200&&f.ok===true&&Number(f.failed)===0&&Number(f.passed)===Number(f.total)&&Number(f.total)>0,
    stockVerified:stock.code===200&&s.ok===true&&s.allVerified===true,
    profitVerified:profit.code===200&&p.ok===true&&Number(p.failed)===0,
    supplierLaunchCandidateReady:launchCandidateSkus.length>0,
    prelaunchAuditReady:prelaunch.code===200&&q.ok===true&&q.readyToFinalManualStep===true
  };
  const ready=Object.values(checks).every(Boolean);
  const inconsistentState=!ready&&nextActions.length===1&&nextActions[0]==='最終手動承認待ち';
  if(inconsistentState){
    nextActions.length=0;
    nextActions.push('監査結果の不整合を再確認');
  }
  return res.status(200).json({
    ok:true,readOnly:true,checkedAt:new Date().toISOString(),ready,inconsistentState,
    checks,
    freight:{total:Number(f.total||0),passed:Number(f.passed||0),failed:Number(f.failed||0)},
    stock:{total:Number(s.total||0),allVerified:Boolean(s.allVerified),launchEligible:Number(s.launchEligible||0),minimumLaunchInventory:Number(s.minimumLaunchInventory||5)},
    profit:{total:Number(p.total||0),verified:Number(p.verified||0),failed:Number(p.failed||0),launchEconomicsEligible:Number(p.launchEconomicsEligible||0),minimumContributionMarginPercent:Number(p.minimumContributionMarginPercent||25)},
    supplierLaunchCandidates:{count:launchCandidateSkus.length,skus:launchCandidateSkus.slice(0,20)},
    skuMatrix,
    skuSummary,
    profitDiagnosis,
    margin30Scenario,
    profitBudgetCandidates,
    catalogTriage,
    nextActions,
    catalogCoverage:{expected:expectedSkus.length,missingSkus,unexpectedSkus,duplicateSkus},
    prelaunch:{readyToFinalManualStep:Boolean(q.readyToFinalManualStep),blockers:Array.isArray(q.blockers)?q.blockers.slice(0,20):[],warnings:Array.isArray(q.warnings)?q.warnings.slice(0,20):[]}
  });
}

function deploymentInfo(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const sha=String(process.env.VERCEL_GIT_COMMIT_SHA||'');
  return res.status(200).json({ok:true,deployedAt:null,commitSha:/^[a-f0-9]{40}$/.test(sha)?sha.slice(0,7):null,deploymentTimeAvailable:false});
}
const handlers={
  'deployment-info':deploymentInfo,
  'preview-prelaunch-summary':previewPrelaunchSummary,
  'preview-cj-draft-audit':previewCjDraftAudit,
  'preview-cj-stock-audit':previewCjStockAudit,
  'preview-profit-audit':previewProfitAudit,
  'preview-launch-audit-summary':previewLaunchAuditSummary,
  'cj-shopify-stock-sync':cjShopifyStockSync,
  'automation-health':automationHealth,
  'automation-order-status':automationOrderStatus,
  'automation-reconciliation':automationReconciliation,
  'cj-health':cjHealth,
  'shopify-fulfillment-sync':shopifyFulfillmentSync,
  'release-readiness':releaseReadiness,
  'shopify-sandbox-order':shopifySandboxOrder,
  'shopify-env-check':shopifyEnvCheck,
  'storefront-checkout':storefrontCheckout,
  'storefront-config':storefrontConfig,
  'prelaunch-product-audit':prelaunchProductAudit,
  'prelaunch-one-action':prelaunchOneAction
};
export default async function handler(req,res){
  const action=String(req.query.action||'');
  const selected=Object.hasOwn(handlers,action)?handlers[action]:null;
  if(!selected)return res.status(404).json({ok:false,error:'Unknown diagnostic route'});
  return selected(req,res);
}
