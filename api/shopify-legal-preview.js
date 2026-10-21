import {loadLegalConfig} from '../lib/legal-config-store.js';
import {getShopifyAuthContext} from '../lib/shopify-auth-context.js';
import {compareLegalPage,findLegalPageCandidates} from '../lib/legal-sync-diff.js';
import {legalSyncReadiness} from '../lib/legal-sync-readiness.js';

function escapeHtml(value){
  return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
export function buildLegalNotice(legal){
  const fields=[
    ['販売業者','sellerName'],['運営責任者','representative'],
    ['所在地','address'],['電話番号','phone'],['メールアドレス','email'],
    ['支払時期','paymentTiming'],['商品引渡し時期','shippingWindow'],
    ['返品受付日数','returnDays'],['返品条件','returnConditions'],
    ['返品送料','returnShipping'],['商品代金以外の必要料金','additionalFees'],
    ['個人情報に関するお問い合わせ','privacyContact']
  ];
  if(!legal||fields.some(([,key])=>!String(legal[key]??'').trim()))throw Error('Legal information is incomplete');
  const days=Number(legal.returnDays);
  if(!Number.isSafeInteger(days)||days<1||days>365)throw Error('Invalid return period');
  return '<section data-oddly-legal="v1"><h1>特定商取引法に基づく表記</h1><dl>'+
    fields.map(([label,key])=>'<dt>'+escapeHtml(label)+'</dt><dd>'+escapeHtml(legal[key])+(key==='returnDays'?'日':'')+'</dd>').join('')+'</dl></section>';
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
  if(!admin||req.headers?.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  try{
    const legal=await loadLegalConfig();
    const proposed=buildLegalNotice(legal);
    const auth=await getShopifyAuthContext(req);
    if(!auth.ok)return res.status(auth.status).json({ok:false,error:auth.error});
    const query='query OddlyLegalPages { pages(first:100) { nodes { id title handle body } pageInfo { hasNextPage } } }';
    const response=await fetch('https://'+auth.shop+'/admin/api/2026-10/graphql.json',{
      method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':auth.token},
      body:JSON.stringify({query}),signal:AbortSignal.timeout(10000)
    });
    if(!response.ok)throw Error('Shopify page lookup failed');
    const data=await response.json();
    if(data.errors?.length)throw Error('Shopify page query failed');
    const pages=data.data?.pages;
    if(!pages||!Array.isArray(pages.nodes))throw Error('Unexpected Shopify page response');
    const matches=findLegalPageCandidates(pages.nodes);
    const complete=!pages.pageInfo?.hasNextPage;
    const readiness=legalSyncReadiness({legalReady:true,shopConnected:true,pageCount:complete?matches.length:-1});
    const comparison=matches.length===1?compareLegalPage(matches[0].body,proposed):null;
    return res.status(200).json({
      ok:true,mode:'read-only',ready:complete&&readiness.ready,
      blockers:complete?readiness.blockers:['page_list_incomplete'],
      matchingPageCount:matches.length,
      changeRequired:comparison?.changed??null,
      requiresReview:comparison?.requiresReview??true,
      changedShopify:false,automaticPublish:false
    });
  }catch(error){
    return res.status(503).json({ok:false,error:String(error?.message||'Legal preview unavailable')});
  }
}
