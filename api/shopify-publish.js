import { getShopifyAuthContext } from '../lib/shopify-auth-context.js';
const VERSION='2026-10';
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(10000)});
  const j=await r.json();if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify API request failed');return j.data;
}
function clean(v,max=5000){return String(v||'').replace(/[<>]/g,'').trim().slice(0,max)}
function cleanHtml(v,max=5000){return String(v||'').replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi,'').replace(/<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi,'').replace(/\son\w+\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)/gi,'').replace(/javascript:/gi,'').trim().slice(0,max)}
function aioMetafields(p,ownerId,title,description){
  const rows=[];
  const audience=clean(p.adpsAudience||p.audience,500);
  const summary=clean(p.adpsSummary||p.summary||description,2000);
  const reasons=Array.isArray(p.adpsWhy||p.why)?(p.adpsWhy||p.why):String(p.adpsWhy||p.why||'').split(/\r?\n|\|/);
  const why=reasons.map(x=>clean(x,500)).filter(Boolean).slice(0,6).join('\n');
  if(audience)rows.push({ownerId,namespace:'custom',key:'adps_audience',type:'single_line_text_field',value:audience});
  if(summary)rows.push({ownerId,namespace:'custom',key:'adps_summary',type:'multi_line_text_field',value:summary});
  if(why)rows.push({ownerId,namespace:'custom',key:'adps_why',type:'multi_line_text_field',value:why});
  const shortTitleJa=clean(p.shortTitleJa||p.adpsShortTitleJa,120);
  const shortDescriptionJa=clean(p.shortDescriptionJa||p.adpsShortDescriptionJa,240);
  if(shortTitleJa)rows.push({ownerId,namespace:'custom',key:'adps_short_title_ja',type:'single_line_text_field',value:shortTitleJa});
  if(shortDescriptionJa)rows.push({ownerId,namespace:'custom',key:'adps_short_description_ja',type:'single_line_text_field',value:shortDescriptionJa});
  // CJ shipping quote integration is not yet server-verified.
  // Do not persist a client-supplied estimate as a confirmed shipping cost.
  const shippingCountry=clean(p.shippingCountry,2).toUpperCase();
  if(/^[A-Z]{2}$/.test(shippingCountry))rows.push({ownerId,namespace:'custom',key:'shipping_country',type:'single_line_text_field',value:shippingCountry});
  const returnDays=Number(p.returnDays);
  if(Number.isInteger(returnDays)&&returnDays>0&&returnDays<=365)rows.push({ownerId,namespace:'custom',key:'return_days',type:'number_integer',value:String(returnDays)});
  return rows;
}
async function translateDraftCopy(title,description){
 const key=process.env.OPENAI_API_KEY;
 if(!key)return null;
 const source=String(description||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,2500);
 try{
  const response=await fetch('https://api.openai.com/v1/chat/completions',{
   method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
   body:JSON.stringify({model:process.env.ODDLY_TRANSLATION_MODEL||'gpt-4o-mini',temperature:0,
    response_format:{type:'json_object'},
    messages:[{role:'system',content:'Translate ecommerce product copy into natural Japanese. Output JSON with title, description, verified. Do not invent specifications, materials, safety claims, certifications, delivery times or features. Keep unverified source claims out. Description is plain text, 1-3 short sentences. verified is true only when translation is reliable and source meaning is clear.'},{role:'user',content:JSON.stringify({title,description:source})}]}),
   signal:AbortSignal.timeout(12000)});
  if(!response.ok)return null;
  const data=await response.json();
  const obj=JSON.parse(data.choices?.[0]?.message?.content||'{}');
  const ja=/[ぁ-んァ-ヶ一-龠]/;
  if(!ja.test(obj.title||'')||!ja.test(obj.description||''))return null;
  return {title:clean(obj.title,180),description:clean(obj.description,1200),verified:obj.verified===true};
 }catch{return null}
}
// CJ allows only one request per second. Serialize calls within this server instance.
// Distributed instances still require a shared queue for a strict global guarantee.
let cjNextRequestAt=0;
let cjRequestQueue=Promise.resolve();
function cjRateLimitedFetch(url,options){
 const run=async()=>{
  const wait=Math.max(0,cjNextRequestAt-Date.now());
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  cjNextRequestAt=Date.now()+1250;
  return fetch(url,options);
 };
 const request=cjRequestQueue.then(run,run);
 cjRequestQueue=request.then(()=>undefined,()=>undefined);
 return request;
}
let cjCache={token:'',expiresAt:0};
async function cjToken(){
  if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
  if(cjCache.token&&Date.now()<cjCache.expiresAt-60000)return cjCache.token;
  if(!process.env.CJ_API_KEY)throw Error('CJ_API_KEY is not configured');
  const r=await cjRateLimitedFetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:process.env.CJ_API_KEY}),signal:AbortSignal.timeout(8000)});
  const j=await r.json();if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error(j.message||'CJ authentication failed');
  cjCache={token:j.data.accessToken,expiresAt:Date.now()+12*60*60*1000};return cjCache.token;
}
async function cjVariant(productId){
  if(!productId)throw Error('CJ商品IDが不足しています');
  const u=new URL('https://developers.cjdropshipping.com/api2.0/v1/product/query');u.searchParams.set('pid',String(productId));
  let r,j;
  for(let attempt=0;attempt<3;attempt++){
    if(attempt)await new Promise(resolve=>setTimeout(resolve,1200*attempt));
    r=await cjRateLimitedFetch(u,{headers:{'CJ-Access-Token':await cjToken()},signal:AbortSignal.timeout(10000)});
    j=await r.json();
    if(r.status!==429&&!/too many requests|qps limit|rate limit/i.test(String(j.message||'')))break;
  }
  if(!r.ok||j.result!==true)throw Error(j.message||'CJ商品情報を取得できません');
  const p=j.data||{},vs=Array.isArray(p.variants)?p.variants:Array.isArray(p.variantList)?p.variantList:[];
  const v=vs.find(x=>x&&(x.vid||x.id||x.variantId));
  if(!v)throw Error('CJバリエーションIDを取得できません');
  // Supplier data is authoritative only for fields actually returned by CJ.
  const rawImages=[p.productImage,p.productImageUrl,p.bigImage,p.image,...(Array.isArray(p.productImages)?p.productImages:[]),...(Array.isArray(p.images)?p.images:[])];
  const extractImages=rawImages.flatMap(x=>{
    if(typeof x==='string'){const z=x.trim();if(z.startsWith('[')){try{return JSON.parse(z)}catch{}}return z.split(/[,|]/)}
    return [x?.url||x?.imageUrl||x?.src||''];
  }).map(x=>String(x||'').trim()).filter(x=>/^https:\/\//i.test(x)).slice(0,12);
  const rawDescription=String(p.description||p.productDescription||p.descriptionHtml||'');
  const safeDescription=cleanHtml(rawDescription,4500);
  return {vid:String(v.vid||v.id||v.variantId),sku:String(v.variantSku||v.sku||''),productId:String(p.pid||p.id||productId),supplierImages:[...new Set(extractImages)],supplierDescription:safeDescription,supplierTitle:clean(p.productName||p.name,250)};

}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const auth=await getShopifyAuthContext(req);
    if(!auth.ok)return res.status(auth.status).json({ok:false,authRequired:Boolean(auth.authRequired),error:auth.error});
    const {token,shop}=auth;
    const raw=req.body||{}; const formPublish=String(raw.formPublish||'')==='1'; const p=raw;
    if(formPublish){p.images=p.image?[p.image]:[];p.descriptionHtml='';p.publishApproved=false;}
    if(p.legalPrefill===true){
      const d=await gql(shop,token,`query OddlyLegalPrefill { shop { name contactEmail billingAddress { address1 address2 city province provinceCode zip country countryCodeV2 phone } } }`);
      const s=d?.shop||{},a=s.billingAddress||{};
      const address=[a.zip,a.province||a.provinceCode,a.city,a.address1,a.address2].map(x=>clean(x,160)).filter(Boolean).join(' ');
      return res.status(200).json({
        ok:true,
        legalPrefill:true,
        source:'shopify-admin-read-only',
        sellerName:clean(s.name,160),
        address:clean(address,300),
        phone:clean(a.phone,80),
        email:clean(s.contactEmail,160)
      });
    }

    if(p.adHealth===true){
      const metaAccountId=String(process.env.META_AD_ACCOUNT_ID||'').replace(/^act_/,'');
      const metaToken=String(process.env.META_ACCESS_TOKEN||'');
      const metaPageId=String(process.env.META_PAGE_ID||'');
      const metaPixelId=String(process.env.META_PIXEL_ID||'');
      const metaGraphVersion=String(process.env.META_GRAPH_VERSION||'v23.0');
      const meta={
        connected:Boolean(metaAccountId&&metaToken),
        accountConfigured:Boolean(metaAccountId),
        tokenConfigured:Boolean(metaToken),
        pageConfigured:Boolean(metaPageId),
        pixelConfigured:Boolean(metaPixelId),
        graphVersion:metaGraphVersion,
        apiOk:false,
        accountName:'',
        accountStatus:null,
        error:''
      };
      if(meta.connected){
        try{
          const u='https://graph.facebook.com/'+encodeURIComponent(metaGraphVersion)+'/act_'+encodeURIComponent(metaAccountId)+'?fields=id,name,account_status&access_token='+encodeURIComponent(metaToken);
          const rr=await fetch(u,{signal:AbortSignal.timeout(10000)});
          const jj=await rr.json();
          if(rr.ok&&!jj?.error){
            meta.apiOk=true;
            meta.accountName=jj?.name||'';
            meta.accountStatus=jj?.account_status??null;
          }else{
            meta.error=jj?.error?.message||'Meta Ads API connection failed';
          }
        }catch(e){
          meta.error=e.message||'Meta Ads API connection failed';
        }
      }
      const google={connected:Boolean(process.env.GOOGLE_ADS_CUSTOMER_ID&&process.env.GOOGLE_ADS_DEVELOPER_TOKEN&&process.env.GOOGLE_ADS_ACCESS_TOKEN),customerConfigured:Boolean(process.env.GOOGLE_ADS_CUSTOMER_ID),developerTokenConfigured:Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),accessTokenConfigured:Boolean(process.env.GOOGLE_ADS_ACCESS_TOKEN)};
      const liveEnabled=String(process.env.ADS_LIVE_ENABLED||'').toLowerCase()==='true';
      const capValue=String(process.env.ADS_MAX_DAILY_JPY??'').trim();
      const capNumber=Number(capValue);
      const maxDailyJpy=/^[1-9][0-9]*$/.test(capValue)&&Number.isSafeInteger(capNumber)?capNumber:0;
      return res.status(200).json({ok:true,adHealth:true,meta,google,liveEnabled,maxDailyJpy});
    }

    if(p.adGuard===true){
      const provider=String(p.provider||'').toLowerCase();
      const action=String(p.action||'').toLowerCase();
      const amounts=[p.dailyBudgetJpy,p.currentSpendJpy,p.requestedBudgetJpy].map(v=>typeof v==='number'?v:(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v.trim())?Number(v.trim()):NaN));
      if(amounts.some(v=>!Number.isFinite(v)||v<0||!Number.isSafeInteger(v)))return res.status(400).json({ok:false,error:'広告予算・使用額は0以上の整数（円）で指定してください'});
      const [dailyBudgetJpy,currentSpendJpy,requestedBudgetJpy]=amounts;
      const allowedProviders=['meta','google'];
      const allowedActions=['create','increase','decrease','pause','resume','hold'];
      if(!allowedProviders.includes(provider))return res.status(400).json({ok:false,error:'広告プロバイダーが不正です'});
      if(!allowedActions.includes(action))return res.status(400).json({ok:false,error:'広告アクションが不正です'});
      const capValue=String(process.env.ADS_MAX_DAILY_JPY??'').trim();
      const serverCapRaw=Number(capValue);
      const serverCap=/^[1-9][0-9]*$/.test(capValue)&&Number.isSafeInteger(serverCapRaw)?serverCapRaw:0;
      const liveEnabled=String(process.env.ADS_LIVE_ENABLED||'').toLowerCase()==='true';
      const effectiveCap=serverCap>0&&dailyBudgetJpy>0?Math.min(serverCap,dailyBudgetJpy):0;
      const reasons=[];
      if(serverCap<=0)reasons.push('サーバー側の日次上限が未設定または不正');
      if(effectiveCap<=0)reasons.push('日次上限が未設定');
      if(requestedBudgetJpy>effectiveCap)reasons.push('要求予算が日次上限を超過');
      if(currentSpendJpy>=effectiveCap&&['create','increase','resume'].includes(action))reasons.push('本日上限に到達');
      if(requestedBudgetJpy>effectiveCap-currentSpendJpy&&['create','increase','resume'].includes(action))reasons.push('本日上限を超過する可能性');
      if(['create','increase','resume'].includes(action)&&requestedBudgetJpy<=0)reasons.push('配信開始・増額・再開には正の予算が必要');
      const testApproved=reasons.length===0;
      const liveApproved=testApproved&&liveEnabled&&serverCap>0;
      return res.status(200).json({
        ok:true,
        guard:true,
        provider,
        action,
        testApproved,
        liveApproved,
        liveEnabled,
        serverCapJpy:serverCap,
        effectiveCapJpy:effectiveCap,
        currentSpendJpy,
        requestedBudgetJpy,
        reasons,
        mode:liveApproved?'live':'test'
      });
    }

    if(p.safeCancelOrder===true){
      if(process.env.SHOPIFY_SAFE_CANCEL_ENABLED!=='true')return res.status(503).json({ok:false,error:'Shopify safe cancellation is disabled'});
      const orderId=String(p.orderId||'');
      if(!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId))return res.status(400).json({ok:false,error:'Shopify注文IDが不正です'});

      const od=await gql(shop,token,'query OrderForSafeCancel($id: ID!) { order(id:$id) { id name test cancelledAt displayFinancialStatus displayFulfillmentStatus } }',{id:orderId});
      const o=od.order;
      if(o&&o.test!==true)return res.status(403).json({ok:false,error:'Only Shopify test orders may be cancelled while sandbox safety mode is active'});
      if(!o)return res.status(404).json({ok:false,error:'Shopify注文が見つかりません'});
      const fin=String(o.displayFinancialStatus||''),ful=String(o.displayFulfillmentStatus||'');

      if(o.cancelledAt)return res.status(409).json({ok:false,error:'この注文はすでにキャンセル済みです'});
      if(!['VOIDED','EXPIRED'].includes(fin))return res.status(409).json({ok:false,error:'安全条件NG：決済状態 '+fin+' は自動キャンセル対象外です'});
      if(!['UNFULFILLED','OPEN','PENDING_FULFILLMENT','ON_HOLD',''].includes(ful))return res.status(409).json({ok:false,error:'安全条件NG：発送状態 '+ful+' は自動キャンセル対象外です'});

      const numericId=orderId.split('/').pop(),storeOrder='SHOP-'+numericId;
      let cjStatus='',cjFound=false;
      try{
        const access=await cjToken();
        const rr=await fetch('https://developers.cjdropshipping.com/api2.0/v1/shopping/order/getOrderDetailBatch',{
          method:'POST',
          headers:{'CJ-Access-Token':access,'Content-Type':'application/json'},
          body:JSON.stringify({orderIds:[storeOrder]}),
          signal:AbortSignal.timeout(10000)
        });
        const jj=await rr.json();
        if(rr.ok&&jj?.result===true){
          const arr=Array.isArray(jj.data)?jj.data:(Array.isArray(jj.data?.list)?jj.data.list:[]);
          const cjo=arr[0]||null;
          if(cjo){cjFound=true;cjStatus=String(cjo.orderStatus||cjo.status||'').toUpperCase()}
        }
      }catch(_e){}

      if(cjFound&&!['CREATED','IN_CART','UNPAID','CANCELLED',''].includes(cjStatus)){
        return res.status(409).json({ok:false,error:'安全条件NG：CJ状態 '+cjStatus+' のため自動キャンセル禁止です'});
      }

      const d=await gql(shop,token,'mutation SafeCancel($orderId: ID!, $notifyCustomer: Boolean!, $refundMethod: OrderCancelRefundMethodInput!, $restock: Boolean!, $reason: OrderCancelReason!, $staffNote: String) { orderCancel(orderId:$orderId, notifyCustomer:$notifyCustomer, refundMethod:$refundMethod, restock:$restock, reason:$reason, staffNote:$staffNote) { job { id done } orderCancelUserErrors { field message code } userErrors { field message } } }',{
        orderId,
        notifyCustomer:true,
        refundMethod:{originalPaymentMethodsRefund:false},
        restock:true,
        reason:'INVENTORY',
        staffNote:'AI BUYER safe cancellation: unpaid/voided order, unfulfilled, CJ not shipped.'
      });
      const out=d.orderCancel||{},errs=[...(out.orderCancelUserErrors||[]),...(out.userErrors||[])];
      if(errs.length)throw Error(errs.map(x=>x.message).join(' / '));
      return res.status(200).json({ok:true,cancelled:true,orderId,name:o.name,financialStatus:fin,fulfillmentStatus:ful,cjFound,cjStatus,jobId:out.job?.id||'',jobDone:Boolean(out.job?.done)});
    }

    if(p.salesSummary===true){
      const now=new Date();
      const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
        timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'
      }).formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
      const y=Number(parts.year),m=Number(parts.month),d=Number(parts.day);
      const jstUtc=(yy,mm,dd)=>new Date(Date.UTC(yy,mm-1,dd)-9*60*60*1000);
      const dayStart=jstUtc(y,m,d);
      const monthStart=jstUtc(y,m,1);
      const yearStart=jstUtc(y,1,1);
      const queryStart=yearStart.toISOString();
      let after=null,nodes=[],pages=0;
      do{
        const data=await gql(shop,token,'query SalesSummary($first:Int!,$after:String,$q:String!){orders(first:$first,after:$after,query:$q,sortKey:CREATED_AT){nodes{id createdAt cancelledAt displayFinancialStatus totalPriceSet{shopMoney{amount currencyCode}} totalRefundedSet{shopMoney{amount currencyCode}} currentTotalPriceSet{shopMoney{amount currencyCode}} lineItems(first:100){nodes{sku quantity}}} pageInfo{hasNextPage endCursor}}}',{first:100,after,q:'created_at:>='+queryStart});
        nodes.push(...(data.orders?.nodes||[]));
        after=data.orders?.pageInfo?.endCursor||null;
        pages++;
        if(!data.orders?.pageInfo?.hasNextPage)break;
      }while(after&&pages<10);
      const eligible=o=>{
        if(o.cancelledAt)return false;
        return ['PAID','PARTIALLY_PAID','AUTHORIZED','PARTIALLY_REFUNDED','REFUNDED'].includes(String(o.displayFinancialStatus||''));
      };
      const gross=o=>Math.max(0,Number(o.totalPriceSet?.shopMoney?.amount||0));
      const refunded=o=>Math.max(0,Number(o.totalRefundedSet?.shopMoney?.amount||0));
      const net=o=>{
        const current=Number(o.currentTotalPriceSet?.shopMoney?.amount);
        if(Number.isFinite(current)&&current>=0)return current;
        return Math.max(0,gross(o)-refunded(o));
      };
      const sumFrom=(start,fn)=>Math.round(nodes.filter(o=>eligible(o)&&new Date(o.createdAt)>=start).reduce((a,o)=>a+fn(o),0));
      const currency=nodes.find(o=>o.totalPriceSet?.shopMoney?.currencyCode)?.totalPriceSet?.shopMoney?.currencyCode||'JPY';
      const dailyGross=sumFrom(dayStart,gross),monthlyGross=sumFrom(monthStart,gross),yearlyGross=sumFrom(yearStart,gross);
      const dailyRefunded=sumFrom(dayStart,refunded),monthlyRefunded=sumFrom(monthStart,refunded),yearlyRefunded=sumFrom(yearStart,refunded);
      const daily=sumFrom(dayStart,net),monthly=sumFrom(monthStart,net),yearly=sumFrom(yearStart,net);
      const rollingNet=days=>{
        const start=new Date(dayStart.getTime()-(Math.max(1,days)-1)*24*60*60*1000);
        const total=sumFrom(start,net);
        return {days,total,average:Math.round(total/Math.max(1,days))};
      };
      const rolling7=rollingNet(7),rolling30=rollingNet(30);
      const unitsFrom=start=>{
        const map={};
        for(const o of nodes){
          if(!eligible(o)||new Date(o.createdAt)<start)continue;
          for(const li of (o.lineItems?.nodes||[])){
            const sku=String(li.sku||'').trim();const qty=Math.max(0,Number(li.quantity||0));
            if(!sku||!Number.isFinite(qty))continue;
            map[sku]=(map[sku]||0)+qty;
          }
        }
        return Object.entries(map).map(([sku,quantity])=>({sku,quantity}));
      };
      return res.status(200).json({
        ok:true,salesSummary:true,timeZone:'Asia/Tokyo',
        daily,monthly,yearly,
        gross:{daily:dailyGross,monthly:monthlyGross,yearly:yearlyGross},
        refunded:{daily:dailyRefunded,monthly:monthlyRefunded,yearly:yearlyRefunded},
        units:{daily:unitsFrom(dayStart),monthly:unitsFrom(monthStart),yearly:unitsFrom(yearStart)},
        rolling:{d7:rolling7,d30:rolling30},
        currency,checkedAt:new Date().toISOString(),ordersScanned:nodes.length,truncated:Boolean(after&&pages>=10)
      });
    }

    if(p.orderAudit===true){
      const data=await gql(shop,token,'query RecentOrders { orders(first:20, reverse:true) { nodes { id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } } lineItems(first:20) { nodes { name quantity sku } } } } }');
      const shopOrders=data.orders?.nodes||[];
      let cjByStoreOrder={};
      let cjLookupVerified=false;
      let cjLookupError='';
      try{
        const ids=shopOrders.map(o=>'SHOP-'+String(o.id||'').split('/').pop()).filter(Boolean);
        if(ids.length){
          const access=await cjToken();
          const rr=await fetch('https://developers.cjdropshipping.com/api2.0/v1/shopping/order/getOrderDetailBatch',{
            method:'POST',
            headers:{'CJ-Access-Token':access,'Content-Type':'application/json'},
            body:JSON.stringify({orderIds:ids}),
            signal:AbortSignal.timeout(10000)
          });
          const jj=await rr.json();
          if(rr.ok&&jj?.result===true){
            cjLookupVerified=true;
            const arr=Array.isArray(jj.data)?jj.data:(Array.isArray(jj.data?.list)?jj.data.list:[]);
            for(const cjo of arr){
              const keys=[cjo.orderNum,cjo.orderNumber,cjo.storeOrderNumber,cjo.platformOrderId,cjo.orderId].filter(Boolean).map(String);
              for(const k of keys)cjByStoreOrder[k]=cjo;
            }
          }else cjLookupError='CJ order lookup failed';
        }else cjLookupVerified=true;
      }catch(e){cjLookupError=String(e?.message||'CJ order lookup unavailable').slice(0,160)}

      // Never infer absence of CJ orders when the remote lookup failed.
      // Order audit remains readable but all destructive actions must be blocked.
      const orders=shopOrders.map(o=>{
        const fin=String(o.displayFinancialStatus||''),ful=String(o.displayFulfillmentStatus||''),cancelled=Boolean(o.cancelledAt);
        const numericId=String(o.id||'').split('/').pop(),storeOrder='SHOP-'+numericId;
        const cjo=cjByStoreOrder[storeOrder]||cjByStoreOrder[numericId]||null;
        const cjStatus=String(cjo?.orderStatus||cjo?.status||'').toUpperCase();
        let state='確認',reason='個別確認が必要です',safeAction='review';

        if(cancelled){state='完了';reason='Shopifyですでにキャンセル済み';safeAction='none'}
        else if(fin==='REFUNDED'||fin==='PARTIALLY_REFUNDED'){state='返金済';reason='返金処理済みまたは一部返金済み';safeAction='none'}
        else if(['SHIPPED','DELIVERED'].includes(cjStatus)){state='要確認';reason='CJ側が'+cjStatus+'のため自動キャンセル禁止';safeAction='review'}
        else if(['PENDING','PROCESSING','UNSHIPPED'].includes(cjStatus)){state='要確認';reason='CJ側で出荷処理中のため自動キャンセル禁止';safeAction='review'}
        else if(cjStatus==='CANCELLED'){state='キャンセル候補';reason='CJ側はキャンセル済み。Shopify側の整合確認が必要';safeAction='cancel_candidate'}
        else if(['CREATED','IN_CART','UNPAID'].includes(cjStatus)&&['UNFULFILLED','OPEN','PENDING_FULFILLMENT','ON_HOLD',''].includes(ful)){
          state='キャンセル候補';reason='CJ側が'+cjStatus+'で未出荷。Shopify側も未発送';safeAction='cancel_candidate'
        }
        else if(['FULFILLED','PARTIALLY_FULFILLED','IN_PROGRESS','SCHEDULED'].includes(ful)){state='要確認';reason='Shopify側で発送処理が進んでいるため自動キャンセル禁止';safeAction='review'}
        else if(['VOIDED','EXPIRED'].includes(fin)){state='キャンセル候補';reason='未発送かつ決済が無効/期限切れ';safeAction='cancel_candidate'}
        else if(fin==='PENDING'){state='保留';reason='決済確認待ちのため発注・返金を保留';safeAction='hold'}
        else if(['PAID','AUTHORIZED','PARTIALLY_PAID'].includes(fin)&&['UNFULFILLED','OPEN','PENDING_FULFILLMENT','ON_HOLD'].includes(ful)){state='要確認';reason=cjo?'CJ状態 '+(cjStatus||'不明')+' を確認してから判断':'CJ注文がまだ見つからないため自動キャンセル禁止';safeAction='review'}

        if(!cjLookupVerified&&safeAction==='cancel_candidate'){
          state='要確認';reason='CJ注文照合が未完了のためキャンセル判定を保留';safeAction='review';
        }
        return {
          id:o.id,name:o.name,createdAt:o.createdAt,cancelledAt:o.cancelledAt,
          financialStatus:fin,fulfillmentStatus:ful,state,reason,safeAction,
          total:o.totalPriceSet?.shopMoney||null,
          items:(o.lineItems?.nodes||[]).map(x=>({name:x.name,quantity:x.quantity,sku:x.sku})),
          cjFound:Boolean(cjo),cjStatus,cjOrderId:cjo?.cjOrderCode||cjo?.orderId||cjo?.cjOrderId||'',storeOrderNumber:storeOrder
        };
      });
      const counts=orders.reduce((a,o)=>(a[o.state]=(a[o.state]||0)+1,a),{});
      return res.status(200).json({ok:true,audit:true,mode:'safe',orders,counts,cjLookupVerified,cjLookupError:(!cjLookupVerified?cjLookupError:'')});
    }
    if(p.createStorefrontToken===true){
      const title=clean(p.title||'ADPS Storefront',120);
      const data=await gql(shop,token,'mutation CreateStorefrontToken($input:StorefrontAccessTokenInput!){ storefrontAccessTokenCreate(input:$input){ storefrontAccessToken{id title accessToken accessScopes{handle} createdAt} userErrors{field message} } }',{input:{title}});
      const result=data.storefrontAccessTokenCreate;
      const errs=result?.userErrors||[];
      if(errs.length)return res.status(409).json({ok:false,error:errs.map(x=>x.message).join(' / ')});
      const created=result?.storefrontAccessToken;
      if(!created?.accessToken)return res.status(502).json({ok:false,error:'Storefront APIトークンを取得できませんでした'});
      const handles=(created.accessScopes||[]).map(x=>x.handle);
      if(!handles.includes('unauthenticated_read_product_listings')){
        return res.status(409).json({ok:false,error:'Storefront商品参照スコープが付与されていません。Shopify再認証が必要です',scopes:handles});
      }
      return res.status(200).json({
        ok:true,
        storefrontTokenCreated:true,
        title:created.title,
        createdAt:created.createdAt,
        accessToken:created.accessToken,
        scopes:handles
      });
    }

    if(p.prelaunchDraftRepair===true){
      const productId=String(p.productId||'').trim();
      if(!/^gid:\/\/shopify\/Product\/\d+$/.test(productId))return res.status(400).json({ok:false,error:'Shopify商品IDが不正です'});
      const existing=await gql(shop,token,'query PrelaunchRepairTarget($id:ID!){product(id:$id){id title description status vendor tags}}',{id:productId});
      const product=existing.product;
      if(!product)return res.status(404).json({ok:false,error:'Shopify商品が見つかりません'});
      if(product.status!=='DRAFT')return res.status(409).json({ok:false,error:'公開中の商品は自動修復しません'});
      if(!['ODDLY','AI BUYER'].includes(String(product.vendor||'')))return res.status(403).json({ok:false,error:'ODDLY管理対象の商品ではありません'});
      const update={id:productId};
      const jp=/[\u3040-\u30ff\u3400-\u9fff]/;
      const titleJa=clean(p.titleJa,250);
      if(titleJa&&jp.test(titleJa))update.title=titleJa;
      const descriptionJa=cleanHtml(p.descriptionHtml||'',5000);
      if(descriptionJa&&jp.test(descriptionJa.replace(/<[^>]*>/g,'')))update.descriptionHtml=descriptionJa;
      const finalTitle=update.title||product.title;
      const finalDescription=update.descriptionHtml||product.description;
      if(jp.test(String(finalTitle||''))&&jp.test(String(finalDescription||'').replace(/<[^>]*>/g,''))){
        const tags=(Array.isArray(product.tags)?product.tags:[]).filter(x=>String(x||'')!=='要日本語確認');
        if(tags.length!==(Array.isArray(product.tags)?product.tags.length:0))update.tags=tags;
      }
      if(Object.keys(update).length===1)return res.status(409).json({ok:false,error:'安全に自動修復できる日本語情報がありません'});
      const d=await gql(shop,token,'mutation PrelaunchRepair($product:ProductUpdateInput!){productUpdate(product:$product){product{id title status} userErrors{field message}}}',{product:update});
      const errs=d.productUpdate?.userErrors||[];
      if(errs.length)return res.status(409).json({ok:false,error:errs.map(x=>x.message).join(' / ')});
      return res.status(200).json({ok:true,prelaunchDraftRepair:true,product:d.productUpdate?.product||null,changedPublicationState:false});
    }

    if(p.aioBackfill===true){
      const productId=String(p.productId||'').trim();
      if(!/^gid:\/\/shopify\/Product\/\d+$/.test(productId))return res.status(400).json({ok:false,error:'Shopify商品IDが不正です'});
      const productData=await gql(shop,token,'query ProductForAio($id:ID!){ product(id:$id){ id title description productType vendor status metafield(namespace:"custom",key:"adps_audience"){value} summary:metafield(namespace:"custom",key:"adps_summary"){value} why:metafield(namespace:"custom",key:"adps_why"){value} } }',{id:productId});
      const product=productData.product;
      if(!product)return res.status(404).json({ok:false,error:'Shopify商品が見つかりません'});
      const existing={
        audience:String(product.metafield?.value||'').trim(),
        summary:String(product.summary?.value||'').trim(),
        why:String(product.why?.value||'').trim()
      };
      const fallbackAudience=clean(p.adpsAudience||p.audience||product.productType||'一般消費者',500);
      const fallbackSummary=clean(p.adpsSummary||p.summary||product.description||product.title,2000);
      const fallbackWhyRaw=Array.isArray(p.adpsWhy||p.why)?(p.adpsWhy||p.why):String(p.adpsWhy||p.why||'').split(/\r?\n|\|/);
      const fallbackWhy=fallbackWhyRaw.map(x=>clean(x,500)).filter(Boolean).slice(0,6);
      if(!fallbackWhy.length){
        if(product.productType)fallbackWhy.push(product.productType+'カテゴリの商品');
        if(product.description)fallbackWhy.push('商品説明が明確で用途を理解しやすい');
        fallbackWhy.push('ADPSの商品選定基準に基づく候補');
      }
      const payload={
        adpsAudience:existing.audience||fallbackAudience,
        adpsSummary:existing.summary||fallbackSummary,
        adpsWhy:existing.why?existing.why.split(/\r?\n|\|/).filter(Boolean):fallbackWhy,
        shippingPriceJpy:p.shippingPriceJpy,
        shippingCountry:p.shippingCountry,
        returnDays:p.returnDays
      };
      const metafields=aioMetafields(payload,productId,product.title,product.description);
      if(!metafields.length)return res.status(409).json({ok:false,error:'補完できるAIO/GEO情報がありません'});
      const meta=await gql(shop,token,'mutation BackfillAio($metafields:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$metafields){ metafields{id namespace key value} userErrors{field message code} } }',{metafields});
      const errs=meta.metafieldsSet?.userErrors||[];
      if(errs.length)return res.status(409).json({ok:false,error:'AIO/GEOメタフィールドの保存に失敗しました',metadataErrors:errs.map(x=>x.message)});
      return res.status(200).json({
        ok:true,
        aioBackfill:true,
        productId,
        title:product.title,
        status:product.status,
        changedPublicationState:false,
        metadataReady:true,
        filled:{
          audience:Boolean(payload.adpsAudience),
          summary:Boolean(payload.adpsSummary),
          why:Boolean(payload.adpsWhy?.length)
        }
      });
    }

    if(p.growthPageOptimize===true){
      const productId=String(p.productId||'').trim();
      const description=cleanHtml(p.descriptionHtml||'',5000);
      if(!/^gid:\/\/shopify\/Product\/\d+$/.test(productId))return res.status(400).json({ok:false,error:'Shopify商品IDが不正です'});
      if(!description)return res.status(400).json({ok:false,error:'日本向け商品説明が空です'});
      const existing=await gql(shop,token,'query GrowthPageDraftCheck($id:ID!){product(id:$id){id status}}',{id:productId});
      if(!existing.product)return res.status(404).json({ok:false,error:'Shopify商品が見つかりません'});
      if(existing.product.status!=='DRAFT')return res.status(409).json({ok:false,error:'公開中の商品は自動下書き最適化できません'});
      const d=await gql(shop,token,'mutation GrowthPageOptimize($product:ProductUpdateInput!){productUpdate(product:$product){product{id title handle status} userErrors{field message}}}',{product:{id:productId,descriptionHtml:description}});
      const errs=d.productUpdate?.userErrors||[];if(errs.length)throw Error(errs.map(x=>x.message).join(' / '));
      return res.status(200).json({ok:true,growthPageOptimized:true,product:d.productUpdate?.product||null});
    }

    const syncAction=String(p.syncAction||'').toLowerCase();
    const livePublishEnabled=process.env.SHOPIFY_LIVE_PUBLISH_ENABLED==='true';
    if(['stop','resume','price'].includes(syncAction)){
      const productId=String(p.productId||''),variantId=String(p.variantId||''),syncPrice=Number(p.price);
      if(!/^gid:\/\/shopify\/Product\/\d+$/.test(productId))return res.status(400).json({ok:false,error:'Shopify商品IDが不正です'});
      const verified=await gql(shop,token,'query SyncTarget($id:ID!){product(id:$id){id status vendor variants(first:100){nodes{id sku} pageInfo{hasNextPage}}}}',{id:productId});
      const targetProduct=verified.product;
      if(!targetProduct||!['ODDLY','AI BUYER'].includes(String(targetProduct.vendor||'')))return res.status(403).json({ok:false,error:'ODDLY管理対象の商品ではありません'});
      if(targetProduct.variants?.pageInfo?.hasNextPage)return res.status(409).json({ok:false,error:'バリエーション照合が不完全なため同期を停止します'});
      if(syncAction==='price'){
        if(!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId)||!Number.isFinite(syncPrice)||syncPrice<=0)return res.status(400).json({ok:false,error:'価格同期に必要な情報が不足しています'});
        if(!(targetProduct.variants?.nodes||[]).some(v=>v.id===variantId))return res.status(403).json({ok:false,error:'商品とバリエーションIDが一致しません'});
        if(targetProduct.status!=='DRAFT'&&(!livePublishEnabled||p.priceChangeApproved!==true))return res.status(403).json({ok:false,error:'公開中商品の価格変更にはサーバー許可と明示承認が必要です'});
        const d=await gql(shop,token,'mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId:$productId, variants:$variants) { productVariants { id price } userErrors { field message } } }',{productId,variants:[{id:variantId,price:String(Math.round(syncPrice))}]});
        const errs=d.productVariantsBulkUpdate?.userErrors||[];if(errs.length)throw Error(errs.map(x=>x.message).join(' / '));
        return res.status(200).json({ok:true,sync:true,action:'price',price:Math.round(syncPrice)});
      }
      if(syncAction==='resume'&&(!livePublishEnabled||p.resumeApproved!==true)){
        return res.status(403).json({ok:false,error:'Shopify live publishing is locked; explicit server opt-in and resume approval are required'});
      }
      const status=syncAction==='stop'?'DRAFT':'ACTIVE';
      const d=await gql(shop,token,'mutation UpdateProduct($product: ProductUpdateInput!) { productUpdate(product:$product) { product { id status } userErrors { field message } } }',{product:{id:productId,status}});
      const errs=d.productUpdate?.userErrors||[];if(errs.length)throw Error(errs.map(x=>x.message).join(' / '));
      if(syncAction==='resume'){
        const pubs=await gql(shop,token,'query Publications { publications(first:20) { nodes { id name autoPublish } } }');
        const nodes=pubs.publications?.nodes||[];
        const target=nodes.find(x=>/online store/i.test(String(x.name||'')));
        if(!target)throw Error('Online Store publication not found; product remains unpublished');
        if(target){
          const pub=await gql(shop,token,'mutation Publish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id:$id, input:$input) { userErrors { field message } } }',{id:productId,input:[{publicationId:target.id}]});
          const pe=pub.publishablePublish?.userErrors||[];if(pe.length)throw Error(pe.map(x=>x.message).join(' / '));
        }
      }
      return res.status(200).json({ok:true,sync:true,action:syncAction,status});
    }
    let title=clean(p.title||p.name,255);
    const vendor=clean('ODDLY',255),price=Number(p.price);
    if(!title||!Number.isFinite(price)||price<=0)return res.status(400).json({ok:false,error:'商品名と販売価格が必要です'});
    const cj=await cjVariant(p.cjProductId||p.id);
    // Translate supplier facts, not only the generic frontend placeholder description.
    // Preserve a Japanese description deliberately written by the merchant.
    const hasJapanese=s=>/[ぁ-んァ-ヶ一-龠]/.test(String(s||''));
    const sourceTitle=cj.supplierTitle||p.name||title;
    const sourceDescription=cj.supplierDescription||p.descriptionHtml||p.description||sourceTitle;
    const merchantJapaneseCopy=hasJapanese(p.descriptionHtml||p.description)&&p.merchantCopyApproved===true;
    const translated=await translateDraftCopy(sourceTitle,sourceDescription);
    if(translated){
      if(!hasJapanese(title)||p.translationVerified!==true)title=translated.title;
      if(!merchantJapaneseCopy)p.descriptionHtml='<p>'+translated.description+'</p>';
      p.translationVerified=translated.verified;
    }else{
      // Never treat partial keyword substitutions as a verified translation.
      p.translationVerified=false;
    }
    // Enrich draft listings with supplier facts and imagery, without inventing specifications.
    // Existing merchant-authored copy takes precedence; CJ source text is included as supplied.
    const merchantImages=(Array.isArray(p.images)?p.images:[]).filter(x=>/^https:\/\//i.test(String(x||'')));
    p.images=[...new Set([...merchantImages,...cj.supplierImages])].slice(0,12);
    // Do not append unreviewed supplier HTML or English specifications to Japanese customer copy.
    // Retain authored copy; if absent, provide a minimal factual draft for human review.
    if(!String(p.descriptionHtml||p.description||'').trim()){
      const safeTitle=clean(title,180);
      p.descriptionHtml='<p>'+safeTitle+'の商品情報を確認中です。仕様・配送条件をご確認のうえ公開してください。</p>';
    }

    const description=cleanHtml(p.descriptionHtml||p.description,5000);
    // Keep public metadata customer-facing; internal automation names are not product tags.
    // A source category is descriptive text, not a Shopify taxonomy ID.
    const category=clean(p.productType||p.category||'',120);
    const verifiedJapaneseCopy=/[\u3040-\u30ff\u3400-\u9fff]/.test(title)&&/[\u3040-\u30ff\u3400-\u9fff]/.test(description.replace(/<[^>]*>/g,''));
    // A draft may be saved with untranslated copy, but it must not be treated as publication-ready.
    const originalEnglish=String(p.name||'');
    const unresolvedEnglish=/\\b(creative|professional|without|version|office|tumbler|personality|breakfast|milk|porcelain|electric jumping|sisal cat|bite.proof|molar|amazon hot)\\b/i.test(title+' '+description.replace(/<[^>]*>/g,''));
    const needsCopyReview=!verifiedJapaneseCopy||unresolvedEnglish||p.translationVerified!==true;
    // Fail closed on higher-risk product classes. Keyword screening is conservative
    // and does not replace supplier documentation or a formal compliance review.
    const safetySource=[cj.supplierTitle,cj.supplierDescription,p.name,p.category].filter(Boolean).join(' ').toLowerCase();
    const safetyRules=[
      {re:/\b(pesticide|insecticide|rodenticide|poison|toxic bait|rat poison|flea medicine|dewormer|antibiotic|prescription|sedative)\b|殺虫剤|駆虫薬|医薬品|毒餌/i,reason:'医薬品・農薬・有害物質の可能性'},
      {re:/\b(electric shock|shock collar|prong collar|choke collar|spiked collar)\b|電気ショック|スパイク首輪/i,reason:'動物への危害リスク'},
      {re:/\b(cbd|thc|cannabis|marijuana|nicotine|vape)\b/i,reason:'規制対象成分の可能性'},
      {re:/\b(laser pointer|high.power laser)\b/i,reason:'レーザー製品の安全性未確認'}
    ];
    const blocked=safetyRules.find(rule=>rule.re.test(safetySource));
    if(blocked)return res.status(422).json({ok:false,safetyBlocked:true,error:'安全審査で保留：'+blocked.reason+'。仕入先の証明を確認するまでShopify登録を停止します。'});
    const safetyReview=/\b(battery|lithium|usb charger|heated|heating|electrical|electric|edible|chew|food|treat|supplement|collar|harness)\b|電池|充電|発熱|電動|おやつ|食品|サプリ|首輪|ハーネス/i.test(safetySource);
    // Publication readiness is independent of permission to save a Shopify DRAFT.
    // Missing review evidence must never be interpreted as a positive safety score.
    // CJ review evidence must come from an independently verified server response.
    // Until that integration exists, treat all ratings as unknown rather than
    // trusting values sent by the browser.
    const reviewsVerified=false;
    const reviewCount=null;
    const averageRating=null;
    const lowRatingShare=null;
    const safetyReasons=[];
    if(!reviewsVerified)safetyReasons.push('レビュー根拠が未確認');
    else {
      if(reviewCount<10)safetyReasons.push('レビュー件数が不足');
      if(averageRating<4)safetyReasons.push('平均評価が4.0未満');
      if(lowRatingShare>0.2)safetyReasons.push('低評価レビュー率が高い');
    }
    if(safetyReview)safetyReasons.push('ペット用品の安全資料・使用上の注意を要確認');
    if(!cj.supplierDescription)safetyReasons.push('仕入先の商品説明が不足');
    if(!cj.supplierImages.length)safetyReasons.push('仕入先の商品画像が不足');
    if(needsCopyReview)safetyReasons.push('日本語の商品情報が未確認');
    // Never trust a client-supplied readiness flag to bypass these checks.
    // Drafts are allowed for inspection; publication is denied unless review
    // evidence is independently verified on the server and all checks pass.
    // Japan shipping must be supported by verified supplier/fulfillment data.
    // A browser-provided shipping estimate is not proof of CJ's actual cost.
    const japanShippingVerified=false; // pending independent CJ quote verification; client flags never authorize publication
    if(!japanShippingVerified)safetyReasons.push('日本向け送料の仕入先確認が未完了');
    const safetyReady=safetyReasons.length===0;
    if(p.publishApproved===true&&!safetyReady)
      return res.status(409).json({ok:false,status:'DRAFT',publicationBlocked:true,
        safetyReady:false,safetyReasons,error:'安全・商品情報の確認が完了していないため公開できません。'});
    const productTags=['ODDLY',...(category?[category]:[]),...(needsCopyReview?['要日本語確認']:[]),...(!safetyReady?['要安全確認']:[])];
    // Reuse an existing AI BUYER draft to avoid duplicates after partial failures.
    // Prefer the CJ variant ID stored as the Shopify SKU; fall back to title only for older drafts.
    const skuMatches=await gql(shop,token,'query ExistingProductsBySku($q:String!){ products(first:30,query:$q){nodes{id title handle status vendor variants(first:100){nodes{id sku}pageInfo{hasNextPage}}}pageInfo{hasNextPage}} }',{q:'sku:'+cj.vid});
    if(!skuMatches.products||!Array.isArray(skuMatches.products.nodes)||typeof skuMatches.products.pageInfo?.hasNextPage!=='boolean')return res.status(502).json({ok:false,error:'Shopifyの商品検索結果を検証できません。出品を停止します。'});
    if(skuMatches.products?.pageInfo?.hasNextPage)return res.status(409).json({ok:false,error:'既存商品の検索結果が多すぎます。重複確認が完了するまで出品を停止します。'});
    if(skuMatches.products.nodes.some(v=>!v||typeof v!=='object'||!Array.isArray(v.variants?.nodes)||typeof v.variants?.pageInfo?.hasNextPage!=='boolean'))return res.status(502).json({ok:false,error:'Shopifyの商品バリエーション情報が不完全です。出品を停止します。'});
    if(skuMatches.products.nodes.some(v=>v.variants?.pageInfo?.hasNextPage))return res.status(409).json({ok:false,error:'商品バリエーションの照合が完了していません。出品を停止します。'});
    const matchingProducts=skuMatches.products.nodes.filter(v=>['AI BUYER','ODDLY'].includes(v.vendor)&&(v.variants?.nodes||[]).some(n=>String(n.sku||'')===String(cj.vid)));
    if(matchingProducts.some(v=>v.status==='ACTIVE'||v.status==='ARCHIVED'))return res.status(409).json({ok:false,error:'同じCJバリエーションIDの商品が公開中またはアーカイブに存在します。重複登録を停止し、Shopifyで確認してください。'});
    const matchingDrafts=skuMatches.products.nodes.filter(v=>v.status==='DRAFT'&&['AI BUYER','ODDLY'].includes(v.vendor)&&(v.variants?.nodes||[]).some(n=>String(n.sku||'')===String(cj.vid)));
    if(matchingDrafts.length>1)return res.status(409).json({ok:false,error:'同じCJバリエーションIDの下書きが複数あります。Shopifyで重複を確認してください。'});
    const existing=matchingDrafts[0]||null;
    const petType=category||(/\b(cat|dog|pet|puppy|kitten|carrier)\b/i.test(title)?'Pet Supplies':'');
    let ce;
    if(existing){
      ce={product:existing,userErrors:[]};
      // Existing draft media is preserved: re-submitting the same images creates duplicates.
      const media=[];
      const upd=await gql(shop,token,'mutation RefreshDraft($product:ProductUpdateInput!,$media:[CreateMediaInput!]){productUpdate(product:$product,media:$media){product{id title handle status variants(first:1){nodes{id}}} userErrors{message}}}',{product:{id:existing.id,title,descriptionHtml:description,vendor,...(petType?{productType:petType}:{})},media});
      if(upd.productUpdate?.userErrors?.length)throw Error(upd.productUpdate.userErrors.map(e=>e.message).join(' / '));
      ce=upd.productUpdate;
    }else{
      const media=[...new Set((Array.isArray(p.images)?p.images:[]).filter(url=>/^https:\/\//i.test(String(url||''))).map(url=>String(url).trim()))].slice(0,6).map((url,i)=>({originalSource:url,mediaContentType:'IMAGE',alt:i===0?title:(title+' '+(i+1))}));
      const create=await gql(shop,token,'mutation CreateProduct($product: ProductCreateInput!,$media:[CreateMediaInput!]) { productCreate(product:$product,media:$media) { product { id title handle status variants(first:1){nodes{id}} } userErrors { field message } } }',{product:{title,descriptionHtml:description,vendor,status:'DRAFT',tags:productTags,...(petType?{productType:petType}:{})},media});
      ce=create.productCreate;
    }
    if(ce.userErrors?.length||!ce.product)throw Error(ce.userErrors?.map(x=>x.message).join(' / ')||'商品作成に失敗しました');
    const variantId=ce.product.variants?.nodes?.[0]?.id;if(!variantId)throw Error('Shopify variant IDを取得できませんでした');
    const update=await gql(shop,token,'mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId:$productId, variants:$variants) { productVariants { id price } userErrors { field message } } }',{productId:ce.product.id,variants:[{id:variantId,price:String(Math.round(price)),inventoryItem:{sku:cj.vid,tracked:false}}]});
    if(update.productVariantsBulkUpdate?.userErrors?.length)throw Error(update.productVariantsBulkUpdate.userErrors.map(x=>x.message).join(' / '));
    const updatedVariant=update.productVariantsBulkUpdate?.productVariants?.[0];
    const confirmedPrice=Number(updatedVariant?.price);
    if(!Number.isFinite(confirmedPrice)||Math.round(confirmedPrice)!==Math.round(price))throw Error('Shopify価格の反映確認に失敗しました。下書きを保持します。');
    const metafields=aioMetafields(p,ce.product.id,title,description);
    let metadataReady=true,metadataErrors=[];
    if(metafields.length){
      const meta=await gql(shop,token,'mutation SetAioMetafields($metafields:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$metafields){ metafields{id namespace key value} userErrors{field message code} } }',{metafields});
      metadataErrors=(meta.metafieldsSet?.userErrors||[]).map(x=>x.message);
      metadataReady=metadataErrors.length===0;
    }
    // AIO/GEO metadata is part of the publication gate. Keep the product draft
    // if Shopify rejected the metadata instead of publishing incomplete content.
    if(!metadataReady){if(formPublish)return res.redirect(303,'/?publish=error&reason=metadata');return res.status(409).json({ok:false,productId:ce.product.id,variantId,status:'DRAFT',metadataReady:false,error:'AIO/GEO metadata could not be saved; draft retained',metadataErrors});}
    // Publishing must be explicit after the CJ variant and Shopify price are validated.
    // Keep the newly created product as a draft until a dedicated approval step.
    if(p.publishApproved!==true||!livePublishEnabled){if(formPublish)return res.redirect(303,'/?publish=done&id='+encodeURIComponent(String(p.id||p.cjProductId||''))+'&productId='+encodeURIComponent(String(ce.product.id||'')));return res.status(200).json({ok:true,productId:ce.product.id,variantId,title:ce.product.title,handle:ce.product.handle,published:false,status:'DRAFT',metadataReady:true,safetyReady,safetyReasons,reviewEvidenceVerified:reviewsVerified,japanShippingVerified,livePublishEnabled,cjVariantId:cj.vid,cjVariantSku:cj.sku,cjProductId:cj.productId});}
    // Resolve the intended channel before activating the draft.
    const pubs=await gql(shop,token,'query Publications { publications(first:20) { nodes { id name autoPublish } } }');
    const nodes=pubs.publications?.nodes||[];
    const target=nodes.find(x=>/online store/i.test(String(x.name||'')));
    if(!target)return res.status(409).json({ok:false,productId:ce.product.id,status:'DRAFT',error:'Online Store channel not found; draft retained'});
    const activated=await gql(shop,token,'mutation ActivateProduct($product: ProductUpdateInput!) { productUpdate(product:$product) { product { id status } userErrors { message } } }',{product:{id:ce.product.id,status:'ACTIVE'}});
    if(activated.productUpdate?.userErrors?.length)throw Error(activated.productUpdate.userErrors.map(x=>x.message).join(' / '));
    const publish=await gql(shop,token,'mutation Publish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id:$id, input:$input) { userErrors { field message } } }',{id:ce.product.id,input:[{publicationId:target.id}]});
    const errs=publish.publishablePublish?.userErrors||[];
    if(errs.length)throw Error(errs.map(x=>x.message).join(' / '));
    return res.status(200).json({ok:true,productId:ce.product.id,variantId,title:ce.product.title,handle:ce.product.handle,published:true,metadataReady:true,publicationConfigured:true,publicationName:target.name,cjVariantId:cj.vid,cjVariantSku:cj.sku,cjProductId:cj.productId});
  }catch(e){if(String(req.body?.formPublish||'')==='1')return res.redirect(303,'/?publish=error&reason='+encodeURIComponent(e.message||'Shopify自動出品に失敗しました'));return res.status(500).json({ok:false,error:e.message||'Shopify自動出品に失敗しました'})}
}