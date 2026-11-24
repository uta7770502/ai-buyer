import { getShopifyAuthContext } from '../shopify-auth-context.js';

const API_VERSION = '2026-10';
const RETURN_DAYS = '7';
const TARGET_COUNT = 9;
const json = (res, status, body) => res.status(status).json(body);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });
  const admin = String(process.env.AI_BUYER_ADMIN_KEY || '');
  if (!admin || req.headers?.authorization !== 'Bearer ' + admin) return json(res, 401, { ok: false, error: 'Unauthorized' });
  if (process.env.SHOPIFY_LIVE_PUBLISH_ENABLED === 'true' || process.env.ODDLY_CHECKOUT_ENABLED === 'true') return json(res, 409, { ok: false, error: 'Live publishing or checkout enabled' });
  const apply = req.body?.apply === true;
  if (apply && (process.env.ADPS_RETURN_DAYS_WRITE_ENABLED !== 'true' || req.body?.confirmation !== 'SET_9_DRAFT_RETURNS_TO_7')) {
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
    const data = await graphql(`query ReturnDrafts { products(first:100,query:"vendor:ODDLY OR vendor:\\"AI BUYER\\"") {
      nodes { id title vendor status metafield(namespace:"custom",key:"return_days") { value } adCost:metafield(namespace:"custom",key:"ad_cost_per_order_jpy"){value} returnReserve:metafield(namespace:"custom",key:"return_reserve_per_order_jpy"){value} }
      pageInfo { hasNextPage }
    } }`);
    const connection = data.products;
    if (!Array.isArray(connection?.nodes) || connection.pageInfo?.hasNextPage !== false) throw Error('Product set incomplete');
    const products = connection.nodes.filter(p => ['ODDLY', 'AI BUYER'].includes(p.vendor) && p.status !== 'ARCHIVED');
    if (products.length !== TARGET_COUNT || products.some(p => p.status !== 'DRAFT') || new Set(products.map(p => p.id)).size !== TARGET_COUNT) {
      return json(res, 409, { ok: false, error: 'Expected exactly nine unique managed DRAFT products', count: products.length });
    }
    if(req.body?.costPreview===true){
      if(apply)return json(res,400,{ok:false,error:'Cost preview is read-only'});
      const valid=v=>typeof v==='string'&&/^\d+$/.test(v)&&Number.isSafeInteger(Number(v));
      const rows=products.map(p=>({id:p.id,title:p.title,adCostJpy:p.adCost?.value??null,returnReserveJpy:p.returnReserve?.value??null,adCostValid:valid(p.adCost?.value),returnReserveValid:valid(p.returnReserve?.value)}));
      return json(res,200,{ok:true,readOnly:true,targetCount:TARGET_COUNT,products:rows,missingAdCost:rows.filter(p=>!p.adCostValid).length,missingReturnReserve:rows.filter(p=>!p.returnReserveValid).length});
    }
    const changes = products.filter(p => p.metafield?.value !== RETURN_DAYS);
    const summary = products.map(p => ({ id: p.id, title: p.title, previousDays: p.metafield?.value ?? null, targetDays: RETURN_DAYS }));
    if (!apply) return json(res, 200, { ok: true, readOnly: true, targetCount: TARGET_COUNT, changeCount: changes.length, products: summary });
    // Do not overwrite a different existing return window without a separate review.
    if (changes.some(p => p.metafield?.value != null && p.metafield.value !== '')) {
      return json(res, 409, { ok: false, error: 'Existing nonempty return window requires manual review', products: summary });
    }
    if (changes.length) {
      const mutation = `mutation SetReturnDays($metafields:[MetafieldsSetInput!]!) {
        metafieldsSet(metafields:$metafields) { metafields { id key value } userErrors { field message code } }
      }`;
      const result = await graphql(mutation, { metafields: changes.map(p => ({
        ownerId: p.id, namespace: 'custom', key: 'return_days', type: 'number_integer', value: RETURN_DAYS
      })) });
      if (result.metafieldsSet?.userErrors?.length || result.metafieldsSet?.metafields?.length !== changes.length) {
        return json(res, 502, { ok: false, error: 'Shopify rejected or partially acknowledged return-day update; re-audit before retry' });
      }
    }
    return json(res, 200, { ok: true, applied: true, updatedCount: changes.length, unchangedCount: TARGET_COUNT - changes.length, publicationChanged: false });
  } catch (error) {
    return json(res, 503, { ok: false, error: error.message || 'Return-day operation unavailable' });
  }
}
