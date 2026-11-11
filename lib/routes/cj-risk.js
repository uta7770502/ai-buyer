import { getCJAccessToken } from '../cj-access-token.js';
import { setTimeout as delay } from 'node:timers/promises';

const BASE='https://developers.cjdropshipping.com/api2.0/v1';
async function getJson(url,headers,signal,stage){
  let r=await fetch(url,{headers,signal});
  if (r.status === 429) {
    const retryAfter = r.headers?.get('Retry-After');
    const waitMs = !retryAfter ? 1000 : /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : Math.max(0, Date.parse(retryAfter) - Date.now());
    if (waitMs <= 2000) {
      await r.body?.cancel();
      await delay(waitMs, undefined, { signal });
      r = await fetch(url, {headers, signal});
    }
  }
  const j=await r.json().catch(()=>null);
  const reviewSuccess = stage !== 'detail' && j?.result === undefined && j?.success === true && j?.code === 0;
  if(!r.ok||(j?.result!==true&&!reviewSuccess)||!j?.data){
    const error=new Error('CJ upstream response rejected');
    error.stage=stage;
    error.upstreamStatus=r.status;
    throw error;
  }
  return j.data;
}
function parseReviewCount(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return NaN;
  return Number(value);
}
function scoreRisk({low,mid,total,rating}){
  if(!Number.isSafeInteger(low)||!Number.isSafeInteger(mid)||low<0||mid<0||low+mid>total)return {level:'unknown',label:'レビュー件数不整合',exclude:true,reason:'review-counts-invalid'};
  const lowRate=total>0?(low+mid)/total:0;
  const rated=Number.isFinite(rating)&&rating>0;
  if(!Number.isSafeInteger(total)||total<=0||!rated)return {level:'unknown',label:'レビュー根拠不足',exclude:true,reason:'review-evidence-insufficient'};
  if(rating>5)return {level:'unknown',label:'評価値不正',exclude:true,reason:'rating-out-of-range'};
  if(rating<4.0)return {level:'mid',label:'評価4.0未満',exclude:true,reason:'rating-below-four'};
  // ODDLY is intentionally conservative: mid/high after-care risk never enters recommendations.
  if(low>=8&&lowRate>=0.12)return {level:'high',label:'返品・クレーム高リスク',exclude:true,reason:'low-review-rate-high'};
  if(low>=3||lowRate>=0.08||(rated&&rating<4.0))return {level:'mid',label:'返品・クレーム要注意',exclude:true,reason:'aftercare-risk-mid'};
  if(total>=10&&lowRate>=0.05)return {level:'mid',label:'低評価比率に注意',exclude:true,reason:'low-review-rate-mid'};
  return {level:'low',label:'返品・クレーム低リスク',exclude:false,reason:'aftercare-risk-low'};
}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const id=String(req.query.id||'').trim();
    if(!/^[a-zA-Z0-9:-]{1,100}$/.test(id))return res.status(400).json({ok:false,error:'Invalid product ID'});
    const signal=AbortSignal.timeout(10000);
    const headers={'CJ-Access-Token':await getCJAccessToken()};
    const detailUrl=new URL(BASE+'/product/query');detailUrl.searchParams.set('pid',id);
    const detail=await getJson(detailUrl,headers,signal,'detail');

    if(!detail||String(detail.pid??detail.id??detail.productId??'')!==id)throw Error('CJ product identity mismatch');
    const reviewUrl=new URL(BASE+'/product/productComments');
    reviewUrl.searchParams.set('pid',id);reviewUrl.searchParams.set('pageNum','1');reviewUrl.searchParams.set('pageSize','1');
    const all=await getJson(reviewUrl,headers,signal,'reviews');

    async function countByScore(score){
      const u=new URL(reviewUrl);u.searchParams.set('score',String(score));
      const d=await getJson(u,headers,signal,'review-score');
      const count=parseReviewCount(d?.total);
      if(d?.total===undefined||d?.total===null||!Number.isSafeInteger(count)||count<0)throw Error('CJ review score count unavailable');
      return count;
    }
    const score1=await countByScore(1);
    const score2=await countByScore(2);
    const total=parseReviewCount(all?.total??detail?.commentCount);
    if(!Number.isSafeInteger(total)||total<0||score1+score2>total)throw Error('CJ review totals inconsistent');
    const rating=Number(detail?.comprehensiveScore||0);
    const risk=scoreRisk({low:score1,mid:score2,total,rating});
    res.setHeader('Cache-Control','private, max-age=300');
    return res.status(200).json({
      ok:true,
      risk:{
        ...risk,
        reviewCount:total,
        lowReviews:score1,
        twoStarReviews:score2,
        rating:Number.isFinite(rating)?rating:0,
        saleStatus:String(detail?.status??''),
        listedNum:Number(detail?.listedNum||0),
        supplierName:String(detail?.supplierName||''),
        checkedAt:new Date().toISOString()
      }
    });
  }catch(e){
    const message=String(e?.message||'');
    const kind=(e?.upstreamStatus===401||e?.upstreamStatus===403)?'CJ_AUTH_REJECTED':e?.stage==='detail'?'CJ_DETAIL_UPSTREAM_REJECTED':e?.stage==='reviews'?'CJ_REVIEWS_UPSTREAM_REJECTED':e?.stage==='review-score'?'CJ_REVIEW_SCORE_UPSTREAM_REJECTED':/CJ_API_KEY is not configured/.test(message)?'CJ_AUTH_CONFIG_MISSING':e?.authFailure||/authentication|access token|CJ authentication/i.test(message)?'CJ_AUTH_FAILED':/product identity mismatch/i.test(message)?'CJ_PRODUCT_ID_MISMATCH':/review score count unavailable|review totals inconsistent/i.test(message)?'CJ_REVIEW_EVIDENCE_UNAVAILABLE':/CJ request failed/i.test(message)?'CJ_UPSTREAM_REJECTED':/timeout|aborted/i.test(message)||e?.name==='TimeoutError'||e?.name==='AbortError'?'CJ_UPSTREAM_TIMEOUT':'CJ_REVIEW_UPSTREAM_ERROR';
    const status=kind==='CJ_AUTH_CONFIG_MISSING'||kind==='CJ_AUTH_FAILED'||kind==='CJ_AUTH_REJECTED'?503:kind==='CJ_PRODUCT_ID_MISMATCH'?502:kind==='CJ_REVIEW_EVIDENCE_UNAVAILABLE'?424:502;
    res.setHeader('Cache-Control','no-store');
    return res.status(status).json({ok:false,code:kind,upstreamStatus:Number.isInteger(e?.upstreamStatus)?e.upstreamStatus:null,error:'CJレビュー情報を検証できません。推薦を保留します。'});
  }
}
