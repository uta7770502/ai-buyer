const VERSION='2026-10';
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
async function gql(shop,token,query,variables={}){
  const r=await fetch('https://'+shop+'/admin/api/'+VERSION+'/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables})});
  const j=await r.json();if(!r.ok||j.errors?.length)throw Error(j.errors?.[0]?.message||'Shopify API request failed');return j.data;
}
function clean(v,max=5000){return String(v||'').replace(/[<>]/g,'').trim().slice(0,max)}
let cjCache={token:'',expiresAt:0};
async function cjToken(){
  if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
  if(cjCache.token&&Date.now()<cjCache.expiresAt-60000)return cjCache.token;
  if(!process.env.CJ_API_KEY)throw Error('CJ_API_KEY is not configured');
  const r=await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:process.env.CJ_API_KEY})});
  const j=await r.json();if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error(j.message||'CJ authentication failed');
  cjCache={token:j.data.accessToken,expiresAt:Date.now()+12*60*60*1000};return cjCache.token;
}
async function cjVariant(productId){
  if(!productId)throw Error('CJ商品IDが不足しています');
  const u=new URL('https://developers.cjdropshipping.com/api2.0/v1/product/query');u.searchParams.set('pid',String(productId));
  const r=await fetch(u,{headers:{'CJ-Access-Token':await cjToken()}});const j=await r.json();
  if(!r.ok||j.result!==true)throw Error(j.message||'CJ商品情報を取得できません');
  const p=j.data||{},vs=Array.isArray(p.variants)?p.variants:Array.isArray(p.variantList)?p.variantList:[];
  const v=vs.find(x=>x&&(x.vid||x.id||x.variantId));
  if(!v)throw Error('CJバリエーションIDを取得できません');
  return {vid:String(v.vid||v.id||v.variantId),sku:String(v.variantSku||v.sku||''),productId:String(p.pid||p.id||productId)};
}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const c=cookies(req),token=String(c.shopify_access_token||''),shop=String(c.shopify_connected_shop||'');
    if(!token||!shop)return res.status(401).json({ok:false,authRequired:true,error:'Shopify認証が必要です'});
    const allowed=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
    if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(allowed)||shop!==allowed)return res.status(403).json({ok:false,error:'Shopify shop is not authorized'});
    const p=req.body||{};
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
          const rr=await fetch(u);
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
      const maxDailyJpy=Math.max(0,Math.round(Number(process.env.ADS_MAX_DAILY_JPY)||0));
      return res.status(200).json({ok:true,adHealth:true,meta,google,liveEnabled,maxDailyJpy});
    }

    if(p.adGuard===true){
      const provider=String(p.provider||'').toLowerCase();
      const action=String(p.action||'').toLowerCase();
      const dailyBudgetJpy=Math.max(0,Math.round(Number(p.dailyBudgetJpy)||0));
      const currentSpendJpy=Math.max(0,Math.round(Number(p.currentSpendJpy)||0));
      const requestedBudgetJpy=Math.max(0,Math.round(Number(p.requestedBudgetJpy)||0));
      const allowedProviders=['meta','google'];
      const allowedActions=['create','increase','decrease','pause','resume','hold'];
      if(!allowedProviders.includes(provider))return res.status(400).json({ok:false,error:'広告プロバイダーが不正です'});
      if(!allowedActions.includes(action))return res.status(400).json({ok:false,error:'広告アクションが不正です'});
      const serverCapRaw=Number(process.env.ADS_MAX_DAILY_JPY||0);
      const serverCap=Number.isFinite(serverCapRaw)&&serverCapRaw>0?Math.round(serverCapRaw):0;
      const liveEnabled=String(process.env.ADS_LIVE_ENABLED||'').toLowerCase()==='true';
      const effectiveCap=serverCap>0?serverCap:dailyBudgetJpy;
      const reasons=[];
      if(effectiveCap<=0)reasons.push('日次上限が未設定');
      if(requestedBudgetJpy>effectiveCap)reasons.push('要求予算が日次上限を超過');
      if(currentSpendJpy>=effectiveCap&&['create','increase','resume'].includes(action))reasons.push('本日上限に到達');
      if(currentSpendJpy+requestedBudgetJpy>effectiveCap&&['create','increase','resume'].includes(action))reasons.push('本日上限を超過する可能性');
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
      const orderId=String(p.orderId||'');
      if(!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId))return res.status(400).json({ok:false,error:'Shopify注文IDが不正です'});

      const od=await gql(shop,token,'query OrderForSafeCancel($id: ID!) { order(id:$id) { id name cancelledAt displayFinancialStatus displayFulfillmentStatus } }',{id:orderId});
      const o=od.order;
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
          body:JSON.stringify({orderIds:[storeOrder]})
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

    if(p.orderAudit===true){
      const data=await gql(shop,token,'query RecentOrders { orders(first:20, reverse:true) { nodes { id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } } lineItems(first:20) { nodes { name quantity sku } } } } }');
      const shopOrders=data.orders?.nodes||[];
      let cjByStoreOrder={};
      try{
        const ids=shopOrders.map(o=>'SHOP-'+String(o.id||'').split('/').pop()).filter(Boolean);
        if(ids.length){
          const access=await cjToken();
          const rr=await fetch('https://developers.cjdropshipping.com/api2.0/v1/shopping/order/getOrderDetailBatch',{
            method:'POST',
            headers:{'CJ-Access-Token':access,'Content-Type':'application/json'},
            body:JSON.stringify({orderIds:ids})
          });
          const jj=await rr.json();
          if(rr.ok&&jj?.result===true){
            const arr=Array.isArray(jj.data)?jj.data:(Array.isArray(jj.data?.list)?jj.data.list:[]);
            for(const cjo of arr){
              const keys=[cjo.orderNum,cjo.orderNumber,cjo.storeOrderNumber,cjo.platformOrderId,cjo.orderId].filter(Boolean).map(String);
              for(const k of keys)cjByStoreOrder[k]=cjo;
            }
          }
        }
      }catch(_e){}

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

        return {
          id:o.id,name:o.name,createdAt:o.createdAt,cancelledAt:o.cancelledAt,
          financialStatus:fin,fulfillmentStatus:ful,state,reason,safeAction,
          total:o.totalPriceSet?.shopMoney||null,
          items:(o.lineItems?.nodes||[]).map(x=>({name:x.name,quantity:x.quantity,sku:x.sku})),
          cjFound:Boolean(cjo),cjStatus,cjOrderId:cjo?.cjOrderCode||cjo?.orderId||cjo?.cjOrderId||'',storeOrderNumber:storeOrder
        };
      });
      const counts=orders.reduce((a,o)=>(a[o.state]=(a[o.state]||0)+1,a),{});
      return res.status(200).json({ok:true,audit:true,mode:'safe',orders,counts});
    }
    const syncAction=String(p.syncAction||'').toLowerCase();
    if(['stop','resume','price'].includes(syncAction)){
      const productId=String(p.productId||''),variantId=String(p.variantId||''),syncPrice=Number(p.price);
      if(!productId)return res.status(400).json({ok:false,error:'Shopify商品IDが必要です'});
      if(syncAction==='price'){
        if(!variantId||!Number.isFinite(syncPrice)||syncPrice<=0)return res.status(400).json({ok:false,error:'価格同期に必要な情報が不足しています'});
        const d=await gql(shop,token,'mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId:$productId, variants:$variants) { productVariants { id price } userErrors { field message } } }',{productId,variants:[{id:variantId,price:String(Math.round(syncPrice))}]});
        const errs=d.productVariantsBulkUpdate?.userErrors||[];if(errs.length)throw Error(errs.map(x=>x.message).join(' / '));
        return res.status(200).json({ok:true,sync:true,action:'price',price:Math.round(syncPrice)});
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
    const title=clean(p.title||p.name,255),description=clean(p.description||p.descriptionHtml,5000),vendor=clean(p.vendor||'AI BUYER',255),price=Number(p.price);
    if(!title||!Number.isFinite(price)||price<=0)return res.status(400).json({ok:false,error:'商品名と販売価格が必要です'});
    const cj=await cjVariant(p.cjProductId||p.id);
    const create=await gql(shop,token,'mutation CreateProduct($product: ProductCreateInput!) { productCreate(product:$product) { product { id title handle status variants(first:1){nodes{id}} } userErrors { field message } } }',{product:{title,descriptionHtml:description,vendor,status:'DRAFT',tags:['AI BUYER','dropshipping']}});
    const ce=create.productCreate;if(ce.userErrors?.length||!ce.product)throw Error(ce.userErrors?.map(x=>x.message).join(' / ')||'商品作成に失敗しました');
    const variantId=ce.product.variants?.nodes?.[0]?.id;if(!variantId)throw Error('Shopify variant IDを取得できませんでした');
    const update=await gql(shop,token,'mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId:$productId, variants:$variants) { productVariants { id price } userErrors { field message } } }',{productId:ce.product.id,variants:[{id:variantId,price:String(Math.round(price)),sku:cj.vid}]});
    if(update.productVariantsBulkUpdate?.userErrors?.length)throw Error(update.productVariantsBulkUpdate.userErrors.map(x=>x.message).join(' / '));
    // Publishing must be explicit after the CJ variant and Shopify price are validated.
    // Keep the newly created product as a draft until a dedicated approval step.
    if(p.publishApproved!==true)return res.status(200).json({ok:true,productId:ce.product.id,variantId,title:ce.product.title,handle:ce.product.handle,published:false,status:'DRAFT',cjVariantId:cj.vid,cjVariantSku:cj.sku,cjProductId:cj.productId});
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
    return res.status(200).json({ok:true,productId:ce.product.id,variantId,title:ce.product.title,handle:ce.product.handle,published:true,publicationConfigured:true,publicationName:target.name,cjVariantId:cj.vid,cjVariantSku:cj.sku,cjProductId:cj.productId});
  }catch(e){return res.status(500).json({ok:false,error:e.message||'Shopify自動出品に失敗しました'})}
}