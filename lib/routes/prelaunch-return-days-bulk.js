import { getShopifyAuthContext } from '../shopify-auth-context.js';

const API_VERSION = '2026-10';
const RETURN_DAYS = '7';
const MAX_ATOMIC_WRITES = 25;
const json = (res, status, body) => res.status(status).json(body);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });
  const admin = String(process.env.AI_BUYER_ADMIN_KEY || '');
  if (!admin || req.headers?.authorization !== 'Bearer ' + admin) return json(res, 401, { ok: false, error: 'Unauthorized' });
  if (process.env.SHOPIFY_LIVE_PUBLISH_ENABLED === 'true' || process.env.ODDLY_CHECKOUT_ENABLED === 'true') return json(res, 409, { ok: false, error: 'Live publishing or checkout enabled' });
  const apply = req.body?.apply === true;
  if (apply && (process.env.ADPS_RETURN_DAYS_WRITE_ENABLED !== 'true' || req.body?.confirmation !== 'SET_CURRENT_DRAFT_RETURNS_TO_7')) {
    return json(res, 403, { ok: false, error: 'Explicit write gate and confirmation required' });
  }
  const auth = await getShopifyAuthContext(req);
  if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
  const endpoint = 'https://' + auth.shop + '/admin/api/' + API_VERSION + '/graphql.json';
  async function graphql(query, variables) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': auth.token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(12000)
    });
    const body = await response.json();
    if (!response.ok || body.errors?.length || !body.data) throw Error('Shopify GraphQL request failed');
    return body.data;
  }
  try {
    const data = await graphql(`query ReturnDrafts { shop { id currencyCode feeRate:metafield(namespace:"custom",key:"payment_fee_rate_percent"){value} fixedFee:metafield(namespace:"custom",key:"payment_fixed_fee_jpy"){value} platformFee:metafield(namespace:"custom",key:"platform_fee_per_order_jpy"){value} } products(first:100,query:"vendor:ODDLY OR vendor:\\"AI BUYER\\"") {
      nodes { id title vendor status variants(first:2){pageInfo{hasNextPage} nodes{price}} metafield(namespace:"custom",key:"return_days") { value } adCost:metafield(namespace:"custom",key:"ad_cost_per_order_jpy"){value} returnReserve:metafield(namespace:"custom",key:"return_reserve_per_order_jpy"){value} }
      pageInfo { hasNextPage }
    } }`);
    const connection = data.products;
    if (!Array.isArray(connection?.nodes) || connection.pageInfo?.hasNextPage !== false) throw Error('Product set incomplete');
    const products = connection.nodes.filter(p => ['ODDLY', 'AI BUYER'].includes(p.vendor) && p.status !== 'ARCHIVED');
    const targetCount=products.length;
    if (targetCount<1 || targetCount>100 || products.some(p => p.status !== 'DRAFT') || products.some(p=>!/^gid:\/\/shopify\/Product\/\d+$/.test(String(p.id||''))) || new Set(products.map(p => p.id)).size !== targetCount) {
      return json(res, 409, { ok: false, error: 'Expected complete unique managed DRAFT products', count: products.length });
    }
    const matchesPreview=ids=>Array.isArray(ids)&&ids.length===targetCount&&new Set(ids).size===targetCount&&products.every(p=>ids.includes(p.id));
    if(apply&&!matchesPreview(req.body?.productIds))return json(res,409,{ok:false,error:'Draft set changed; preview again'});
    if(req.body?.feePreview===true){
      if(apply||req.body.costApply===true)return json(res,400,{ok:false,error:'Fee preview is read-only'});
      return json(res,200,{ok:true,readOnly:true,shopLevel:true,currencyCode:data.shop?.currencyCode??null,paymentFeeRatePercent:data.shop?.feeRate?.value??null,paymentFixedFeeJpy:data.shop?.fixedFee?.value??null,platformFeePerOrderJpy:data.shop?.platformFee?.value??null});
    }
    if(req.body?.feeApply===true){
      if(apply||req.body.costApply===true||req.body.confirmation!=='SET_PAYMENT_FEE_ASSUMPTIONS')return json(res,403,{ok:false,error:'Explicit fee confirmation required'});
      if(data.shop?.currencyCode!=='JPY'||!data.shop?.id)return json(res,409,{ok:false,error:'JPY shop identity required'});
      const rate=req.body.paymentFeeRatePercent,fixed=req.body.paymentFixedFeeJpy,platform=req.body.platformFeePerOrderJpy;
      if(!Number.isFinite(rate)||rate<0||rate>=70||!Number.isSafeInteger(fixed)||fixed<0||fixed>1000000||!Number.isSafeInteger(platform)||platform<0||platform>1000000)return json(res,400,{ok:false,error:'Invalid payment fee assumptions'});
      const desired=[
        ['feeRate','payment_fee_rate_percent','number_decimal',String(rate)],
        ['fixedFee','payment_fixed_fee_jpy','number_integer',String(fixed)],
        ['platformFee','platform_fee_per_order_jpy','number_integer',String(platform)]
      ];
      const conflicts=desired.filter(([alias,,,value])=>data.shop?.[alias]?.value!=null&&String(data.shop[alias].value)!==value);
      if(conflicts.length)return json(res,409,{ok:false,error:'Existing payment fee assumptions require manual review',keys:conflicts.map(([,key])=>key)});
      const writes=desired.filter(([alias])=>data.shop?.[alias]?.value==null).map(([,key,type,value])=>({ownerId:data.shop.id,namespace:'custom',key,type,value,compareDigest:null}));
      if(writes.length){
        const result=await graphql('mutation SetPaymentFeeAssumptions($metafields:[MetafieldsSetInput!]!){metafieldsSet(metafields:$metafields){metafields{id key value} userErrors{field message code}}}',{metafields:writes});
        if(result.metafieldsSet?.userErrors?.length||result.metafieldsSet?.metafields?.length!==writes.length)return json(res,409,{ok:false,error:'Payment fee assumptions not confirmed'});
      }
      return json(res,200,{ok:true,applied:true,shopLevel:true,updatedCount:writes.length,profitVerified:false,publicationChanged:false});
    }
    if(req.body?.costScenario===true){
      if(apply||req.body.costApply===true||req.body.costPreview===true)return json(res,400,{ok:false,error:'Scenario is read-only'});
      const {adRatePercent,returnRatePercent}=req.body;
      if(![adRatePercent,returnRatePercent].every(n=>Number.isInteger(n)&&n>=0&&n<=100)||adRatePercent+returnRatePercent>=100)return json(res,400,{ok:false,error:'Explicit integer percentage assumptions required'});
      if(data.shop?.currencyCode!=='JPY')return json(res,409,{ok:false,error:'JPY shop required'});
      const rows=products.map(p=>{
        const v=p.variants,raw=v?.nodes?.[0]?.price;
        const price=typeof raw==='string'&&/^\d+(?:\.0+)?$/.test(raw)?Number(raw):NaN;
        if(v?.pageInfo?.hasNextPage!==false||v.nodes?.length!==1||!Number.isSafeInteger(price)||price<=0||price>100000000)throw Error('Single variant integer JPY price required');
        return {id:p.id,title:p.title,priceJpy:price,proposedAdCostJpy:Math.ceil(price*adRatePercent/100),proposedReturnReserveJpy:Math.ceil(price*returnRatePercent/100),existingAdCostJpy:p.adCost?.value??null,existingReturnReserveJpy:p.returnReserve?.value??null};
      });
      return json(res,200,{ok:true,readOnly:true,estimated:true,profitVerified:false,targetCount:targetCount,adRatePercent,returnRatePercent,products:rows});
    }
    if(req.body?.costApply===true){
      if(apply||req.body.costPreview===true||req.body.confirmation!=='SET_MISSING_DRAFT_COSTS')return json(res,403,{ok:false,error:'Explicit confirmation required'});
      const fields=[['adCost','ad_cost_per_order_jpy','adCostJpy'],['returnReserve','return_reserve_per_order_jpy','returnReserveJpy']];
      const valid=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000;
      const scenario=req.body.costMode==='percentage';
      const rates=[req.body.adRatePercent,req.body.returnRatePercent];
      if(scenario&&(!rates.every(n=>Number.isInteger(n)&&n>=0&&n<=99)||rates[0]+rates[1]>=100||data.shop?.currencyCode!=='JPY'))return json(res,400,{ok:false,error:'Invalid percentage assumptions or currency'});
      if(!scenario&&!fields.every(([, ,input])=>valid(req.body[input])))return json(res,400,{ok:false,error:'Explicit nonnegative integer JPY costs required'});
      const expected=req.body.productIds;
      if(!matchesPreview(expected))return json(res,409,{ok:false,error:'Draft set changed; preview again'});
      const amounts=new Map();
      if(scenario){
        const quoted=req.body.quotedPrices;
        if(!Array.isArray(quoted)||quoted.length!==targetCount||new Set(quoted.map(q=>q?.id)).size!==targetCount)return json(res,409,{ok:false,error:'Preview prices required'});
        for(const p of products){
          const v=p.variants,raw=v?.nodes?.[0]?.price;
          const price=typeof raw==='string'&&/^\d+(?:\.0+)?$/.test(raw)?Number(raw):NaN;
          if(v?.pageInfo?.hasNextPage!==false||v.nodes?.length!==1||!valid(price)||price===0||!quoted.some(q=>q.id===p.id&&q.priceJpy===price))return json(res,409,{ok:false,error:'Price or variant changed; preview again'});
          amounts.set(p.id,{adCostJpy:Math.ceil(price*rates[0]/100),returnReserveJpy:Math.ceil(price*rates[1]/100)});
        }
      }
      const writes=[];
      for(const p of products)for(const [alias,key,input] of fields){
        if(p[alias]!==null&&p[alias]!==undefined)continue;
        writes.push({ownerId:p.id,namespace:'custom',key,type:'number_integer',value:String(scenario?amounts.get(p.id)[input]:req.body[input]),compareDigest:null});
      }
      if(writes.length>MAX_ATOMIC_WRITES)return json(res,409,{ok:false,error:'Too many writes for one atomic operation; review individually'});
      if(writes.length){
        const result=await graphql('mutation SetDraftCosts($metafields:[MetafieldsSetInput!]!){metafieldsSet(metafields:$metafields){metafields{id key value} userErrors{field message code}}}',{metafields:writes});
        if(result.metafieldsSet?.userErrors?.length||result.metafieldsSet?.metafields?.length!==writes.length)return json(res,409,{ok:false,error:'Cost update not confirmed; preview again'});
      }
      return json(res,200,{ok:true,applied:true,updatedCount:writes.length,publicationChanged:false,profitVerified:false});
    }
    if(req.body?.costPreview===true){
      if(apply)return json(res,400,{ok:false,error:'Cost preview is read-only'});
      const valid=v=>typeof v==='string'&&/^\d+$/.test(v)&&Number.isSafeInteger(Number(v));
      const rows=products.map(p=>({id:p.id,title:p.title,adCostJpy:p.adCost?.value??null,returnReserveJpy:p.returnReserve?.value??null,adCostValid:valid(p.adCost?.value),returnReserveValid:valid(p.returnReserve?.value)}));
      return json(res,200,{ok:true,readOnly:true,targetCount:targetCount,products:rows,missingAdCost:rows.filter(p=>!p.adCostValid).length,missingReturnReserve:rows.filter(p=>!p.returnReserveValid).length});
    }
    const changes = products.filter(p => p.metafield?.value !== RETURN_DAYS);
    const summary = products.map(p => ({ id: p.id, title: p.title, previousDays: p.metafield?.value ?? null, targetDays: RETURN_DAYS }));
    if (!apply) return json(res, 200, { ok: true, readOnly: true, targetCount: targetCount, changeCount: changes.length, products: summary });
    // Do not overwrite a different existing return window without a separate review.
    if (changes.some(p => p.metafield != null)) {
      return json(res, 409, { ok: false, error: 'Existing nonempty return window requires manual review', products: summary });
    }
    if(changes.length>MAX_ATOMIC_WRITES)return json(res,409,{ok:false,error:'Too many writes for one atomic operation; review individually'});
    if (changes.length) {
      const mutation = `mutation SetReturnDays($metafields:[MetafieldsSetInput!]!) {
        metafieldsSet(metafields:$metafields) { metafields { id key value } userErrors { field message code } }
      }`;
      const result = await graphql(mutation, { metafields: changes.map(p => ({
        ownerId: p.id, namespace: 'custom', key: 'return_days', type: 'number_integer', value: RETURN_DAYS, compareDigest:null
      })) });
      if (result.metafieldsSet?.userErrors?.length || result.metafieldsSet?.metafields?.length !== changes.length) {
        return json(res, 502, { ok: false, error: 'Shopify rejected or partially acknowledged return-day update; re-audit before retry' });
      }
    }
    return json(res, 200, { ok: true, applied: true, updatedCount: changes.length, unchangedCount: targetCount - changes.length, publicationChanged: false });
  } catch (error) {
    return json(res, 503, { ok: false, error: error.message || 'Return-day operation unavailable' });
  }
}
