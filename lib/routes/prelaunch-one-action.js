import releaseReadiness from './release-readiness.js';
import prelaunchProductAudit from './prelaunch-product-audit.js';
import automationReconciliation from './automation-reconciliation.js';

function capture(){
  let resolve;
  const done=new Promise(r=>{resolve=r});
  const res={
    code:200,headers:{},
    setHeader(k,v){this.headers[k]=v;return this},
    status(n){this.code=n;return this},
    json(v){this.body=v;resolve({code:this.code,body:v});return this},
    send(v){this.body=v;resolve({code:this.code,body:v});return this},
    end(){resolve({code:this.code,body:this.body});return this}
  };
  return {res,done};
}
async function invoke(handler,req){
  const {res,done}=capture();
  return await Promise.race([handler(req,res).then(()=>done),new Promise((_,reject)=>setTimeout(()=>reject(Error('Prelaunch diagnostic timeout')),20000))]);
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
  if(!admin||req.headers?.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});

  // Safety contract: this endpoint only invokes read-only diagnostics.
  if(
    process.env.SHOPIFY_LIVE_PUBLISH_ENABLED==='true'||
    process.env.CJ_ALLOW_REAL_SHOPIFY_ORDERS_IN_SANDBOX==='true'||
    String(process.env.ADS_LIVE_ENABLED||'').toLowerCase()==='true'||
    String(process.env.ODDLY_CHECKOUT_ENABLED||'').toLowerCase()==='true'||
    String(process.env.ODDLY_SEARCH_INDEX_ENABLED||'').toLowerCase()==='true'
  ){
    return res.status(409).json({ok:false,error:'公開系スイッチがONです。ワンアクション準備は安全のため停止しました。'});
  }

  const base={headers:req.headers,body:{},query:{}};
  // Independent read-only checks run concurrently to reduce prelaunch wait time.
  // A rejected check must never be interpreted as a successful audit.
  const [readiness,audit,reconciliation]=await Promise.all([
    invoke(releaseReadiness,{...base,method:'GET'}),
    invoke(prelaunchProductAudit,{...base,method:'GET'}),
    invoke(automationReconciliation,{...base,method:'GET',query:{kind:'summary'}})
  ].map(p=>p.catch(()=>({code:503,body:{ok:false}}))));

  const checks={
    readiness:readiness.code===200&&readiness.body?.ok===true,
    shopifyDraftAudit:audit.code===200&&audit.body?.ok===true&&audit.body?.allDraftsReady===true&&!audit.body?.partial,
    noUnresolvedOrders:reconciliation.code===200&&reconciliation.body?.ok===true&&
      Number.isSafeInteger(reconciliation.body?.summary?.total)&&reconciliation.body.summary.total===0&&
      Number.isSafeInteger(reconciliation.body?.summary?.critical)&&reconciliation.body.summary.critical===0&&
      Number.isSafeInteger(reconciliation.body?.summary?.review)&&reconciliation.body.summary.review===0&&
      reconciliation.body?.summary?.partial===false,
    liveSwitchesOff:true
  };
  const blockers=[];
  if(!checks.readiness)blockers.push('公開準備チェックを完了できません');
  else blockers.push(...(Array.isArray(readiness.body?.blockers)?readiness.body.blockers:[]));
  if(!checks.shopifyDraftAudit){
    if(Number.isSafeInteger(audit.body?.nonDraftCount)&&audit.body.nonDraftCount>0)blockers.push('管理対象の商品が下書き以外になっています: '+audit.body.nonDraftCount+'件');
    if(audit.body?.blockedDrafts>0)blockers.push('Shopify下書き商品に未完了項目があります: '+audit.body.blockedDrafts+'件');
    if(audit.body?.ok!==true||audit.body?.partial===true||!audit.body?.allDraftsReady&&!(audit.body?.blockedDrafts>0||audit.body?.nonDraftCount>0))blockers.push('Shopify下書き商品監査を完了できません');
  }
  if(!checks.noUnresolvedOrders){
    const n=Number(reconciliation.body?.summary?.total||0);
    blockers.push(n>0?'要照合の注文処理があります: '+n+'件':'注文照合キューを確認できません');
  }

  const remainingVerification=Array.isArray(readiness.body?.remainingLiveVerification)?readiness.body.remainingLiveVerification:[];
  blockers.push(...remainingVerification.map(item=>'未検証：'+item));

  const warnings=Array.isArray(readiness.body?.warnings)?readiness.body.warnings:[];
  const readyToFinalManualStep=
    checks.readiness&&checks.shopifyDraftAudit&&checks.noUnresolvedOrders&&
    readiness.body?.prelaunchReady===true&&warnings.length===0&&blockers.length===0;

  return res.status(200).json({
    ok:true,
    action:'prepare-to-one-step-before-launch',
    safetyContract:'prelaunch-read-only-v1',
    changedPublicationState:false,
    changedCheckoutState:false,
    createdLiveOrder:false,
    changedAdsState:false,
    removedStorefrontPassword:false,
    readyToFinalManualStep,
    checkedAt:new Date().toISOString(),
    checks,
    blockers:[...new Set(blockers)],
    warnings,
    readiness:{
      legalReady:Boolean(readiness.body?.legalReady),
      shopifyServerAuthReady:Boolean(readiness.body?.shopifyServerAuthReady),
      storefrontReady:Boolean(readiness.body?.storefrontReady),
      sandboxOrderReady:Boolean(readiness.body?.sandboxOrderReady),
      externalChecks:readiness.body?.externalChecks||{}
    },
    productAudit:{
      draftCount:Number(audit.body?.draftCount||0),
      readyDrafts:Number(audit.body?.readyDrafts||0),
      blockedDrafts:Number(audit.body?.blockedDrafts||0),
      totalIssues:Number(audit.body?.totalIssues||0),
      nonDraftCount:Number(audit.body?.nonDraftCount||0),
      products:Array.isArray(audit.body?.products)?audit.body.products.filter(x=>!x.ready).slice(0,20):[]
    },
    reconciliation:reconciliation.body?.summary||null,
    finalLaunchManifest:{
      serverVerified:readyToFinalManualStep,
      requiresExplicitUserApproval:true,
      steps:[
        {order:1,key:'activate-approved-products',label:'承認商品のACTIVE化'},
        {order:2,key:'enable-checkout',label:'Checkout本番ON'},
        {order:3,key:'verify-live-payment',label:'Shopify決済の最終確認'},
        {order:4,key:'remove-storefront-password',label:'ストアパスワード解除'}
      ],
      forbiddenUntilApproval:['product activation','checkout enable','live CJ order','ads enable','password removal']
    },
    next:readyToFinalManualStep
      ?['承認商品のACTIVE化','ODDLY_CHECKOUT_ENABLED=true','最終Shopify決済確認','ストアパスワード解除']
      :['blockersを解消して再実行']
  });
}
