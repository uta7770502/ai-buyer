import { getCJAccessToken } from '../cj-access-token.js';
import { setTimeout as delay } from 'node:timers/promises';

const BASE='https://developers.cjdropshipping.com/api2.0/v1';
async function getJson(url,headers,signal,stage){
  // Preserve the failing stage when fetch itself rejects (including aborts).
  async function fetchAtStage() {
    try { return await fetch(url, { headers, signal }); }
    catch (cause) {
      const error = new Error('CJ upstream request failed');
      error.stage = stage;
      error.name = signal?.aborted || cause?.name === 'AbortError' || cause?.name === 'TimeoutError' ? 'TimeoutError' : 'CJFetchError';
      throw error;
    }
  }
  let r=await fetchAtStage();
  // Retry a transient server failure once, preserving the shared 10s deadline.
  // Never retry authentication errors or treat a retry as review evidence.
  let retried = false;
  if ([500, 502, 503, 504].includes(r.status)) {
    retried = true;
    await r.body?.cancel().catch(() => {});
    try { await delay(150, undefined, { signal }); }
    catch { throw Object.assign(new Error('CJ retry deadline exceeded'), { name: 'TimeoutError', stage }); }
    r = await fetchAtStage();
  }
  // A gateway retry followed by 429 must not trigger a third request.
  if (r.status === 429 && !retried) {
    const retryAfter = r.headers?.get('Retry-After');
    const waitMs = !retryAfter ? 1000 : /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : Math.max(0, Date.parse(retryAfter) - Date.now());
    if (Number.isFinite(waitMs) && waitMs >= 0 && waitMs <= 2000) {
      await r.body?.cancel().catch(() => {});
      try { await delay(waitMs, undefined, { signal }); }
      catch { throw Object.assign(new Error('CJ rate-limit retry deadline exceeded'), { name: 'TimeoutError', stage }); }
      r = await fetchAtStage();
    }
  }
  // Do not parse upstream error bodies: they can contain private CJ diagnostics.
  if (!r.ok) {
    await r.body?.cancel().catch(() => {});
    const error = new Error('CJ upstream HTTP failure');
    error.stage = stage;
    error.upstreamStatus = r.status;
    throw error;
  }
  // An explicitly non-JSON response is never valid review evidence.
  const contentType = r.headers?.get?.('content-type');
  if (!contentType || !/^application\/(?:[a-z0-9][a-z0-9.+-]*\+)?json(?:\s*;|\s*$)/i.test(contentType)) {
    await r.body?.cancel().catch(() => {});
    const error = new Error('CJ upstream response rejected');
    error.stage = stage;
    error.upstreamStatus = r.status;
    error.diagnosticReason = 'cj_response_media_type_invalid';
    throw error;
  }
  let j;
  try { j = await r.json(); }
  catch (cause) {
    // Preserve the failing CJ stage even for malformed JSON or a timed-out body.
    if (signal?.aborted || cause?.name === 'AbortError' || cause?.name === 'TimeoutError') {
      throw Object.assign(new Error('CJ upstream response deadline exceeded'), { name: 'TimeoutError', stage });
    }
    throw Object.assign(new Error('CJ upstream JSON invalid'), { stage, diagnosticReason: 'cj_response_json_invalid' });
  }
  const reviewSuccess = stage !== 'detail' && j?.result === undefined && j?.success === true && j?.code === 0;
  if(!r.ok||(j?.result!==true&&!reviewSuccess)||!j?.data){
    const error=new Error('CJ upstream response envelope unrecognized');
    error.schemaMismatch=true;
    error.diagnosticReason = 'cj_response_envelope_unrecognized';
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
export function scoreRisk({low,mid,total,rating}){
  if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(low)||!Number.isSafeInteger(mid)||low<0||mid<0||low+mid>total)return {level:'unknown',label:'レビュー件数不整合',exclude:true,reason:'review-counts-invalid'};
  const lowRate=total>0?(low+mid)/total:0;
  const rated=Number.isFinite(rating)&&rating>0;
  if(!Number.isSafeInteger(total)||total<10||!rated)return {level:'unknown',label:'レビュー根拠不足',exclude:true,reason:'review-evidence-insufficient'};
  if(rating>5)return {level:'unknown',label:'評価値不正',exclude:true,reason:'rating-out-of-range'};
  if(rating<4.0)return {level:'mid',label:'評価4.0未満',exclude:true,reason:'rating-below-four'};
  // ODDLY is intentionally conservative: mid/high after-care risk never enters recommendations.
  if(low>=8&&lowRate>=0.12)return {level:'high',label:'返品・クレーム高リスク',exclude:true,reason:'low-review-rate-high'};
  if(low>=3||lowRate>=0.08||(rated&&rating<4.0))return {level:'mid',label:'返品・クレーム要注意',exclude:true,reason:'aftercare-risk-mid'};
  if(total>=10&&lowRate>=0.05)return {level:'mid',label:'低評価比率に注意',exclude:true,reason:'low-review-rate-mid'};
  return {level:'low',label:'返品・クレーム低リスク',exclude:false,reason:'aftercare-risk-low'};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    // Reject array/object query parameters rather than silently coercing them to a product ID.
    // An ambiguous identifier must never be used to obtain recommendation evidence.
    const rawId=req.query?.id;
    if(typeof rawId!=='string'||rawId!==rawId.trim()||!/^[a-zA-Z0-9:-]{1,100}$/.test(rawId))return res.status(400).json({ok:false,error:'Invalid product ID'});
    const id=rawId;
    // The total 10s budget includes authentication; AbortSignal alone cannot
    // interrupt a token refresh that does not accept a signal.
    const deadline=Date.now()+10000;
    let authTimer;
    let token;
    try {
      token=await Promise.race([
        getCJAccessToken().catch(error => { throw Object.assign(error, { stage: 'auth' }); }),
        new Promise((_,reject)=>{
          authTimer=setTimeout(()=>reject(Object.assign(new Error('CJ auth deadline exceeded'),{name:'TimeoutError',stage:'auth'})),10000);
        })
      ]);
    } finally {
      clearTimeout(authTimer);
    }
    const remaining=deadline-Date.now();
    if(remaining<=0)throw Object.assign(new Error('CJ auth deadline exceeded'),{name:'TimeoutError',stage:'auth'});
    const signal=AbortSignal.timeout(remaining);
    // Reject malformed credentials locally; never send control characters or whitespace upstream.
    if (typeof token !== 'string' || !token.trim() || token !== token.trim() || /[\x00-\x1f\x7f]/.test(token)) {
      return res.status(503).json({ok:false,code:'CJ_AUTH_INVALID',error:'CJレビュー情報を検証できません。推薦を保留します。'});
    }
    const headers={'CJ-Access-Token':token};
    const detailUrl=new URL(BASE+'/product/query');detailUrl.searchParams.set('pid',id);
    const detail=await getJson(detailUrl,headers,signal,'detail');

    if(!detail||String(detail.pid??detail.id??detail.productId??'')!==id)throw Object.assign(new Error('CJ product identity mismatch'), {stage:'detail'});
    const reviewUrl=new URL(BASE+'/product/productComments');
    reviewUrl.searchParams.set('pid',id);reviewUrl.searchParams.set('pageNum','1');reviewUrl.searchParams.set('pageSize','1');
    const all=await getJson(reviewUrl,headers,signal,'reviews');

    async function countByScore(score){
      const u=new URL(reviewUrl);u.searchParams.set('score',String(score));
      let d;
      try { d=await getJson(u,headers,signal,'review-score'); }
      catch (error) { error.reviewScore = score; throw error; }
      const count=parseReviewCount(d?.total);
      if(d?.total===undefined||d?.total===null||!Number.isSafeInteger(count)||count<0)throw Object.assign(new Error('CJ review score count unavailable'), {stage:'review-score',reviewScore:score,diagnosticReason:'cj_review_score_total_invalid'});
      return count;
    }
    // Both score totals are independent. Fetch concurrently to reduce the shared
    // 10-second review deadline pressure without weakening either evidence gate.
    const [score1, score2] = await Promise.all([countByScore(1), countByScore(2)]);
    // Do not substitute catalog commentCount for missing live review pagination evidence.
    // The catalog count may be stale and must not authorize a recommendation.
    const total=parseReviewCount(all?.total);
    if(!Number.isSafeInteger(total)||total<0||score1+score2>total)throw Object.assign(new Error('CJ review totals inconsistent'), {stage:'reviews',diagnosticReason:'cj_review_totals_invalid'});
    const rating=Number(detail?.comprehensiveScore||0);
    const risk=scoreRisk({low:score1,mid:score2,total,rating});
    res.setHeader('Cache-Control','no-store');
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
    const kind=(e?.upstreamStatus===401||e?.upstreamStatus===403)?'CJ_AUTH_REJECTED':(e?.name==='TimeoutError'||e?.name==='AbortError'||/timeout|aborted/i.test(message))?'CJ_UPSTREAM_TIMEOUT':/product identity mismatch/i.test(message)?'CJ_PRODUCT_ID_MISMATCH':/review score count unavailable|review totals inconsistent/i.test(message)?'CJ_REVIEW_EVIDENCE_UNAVAILABLE':e?.stage==='detail'?'CJ_DETAIL_UPSTREAM_REJECTED':e?.stage==='reviews'?'CJ_REVIEWS_UPSTREAM_REJECTED':e?.stage==='review-score'?'CJ_REVIEW_SCORE_UPSTREAM_REJECTED':/CJ_API_KEY is not configured/.test(message)?'CJ_AUTH_CONFIG_MISSING':e?.authFailure||/authentication|access token|CJ authentication/i.test(message)?'CJ_AUTH_FAILED':/CJ request failed/i.test(message)?'CJ_UPSTREAM_REJECTED':/timeout|aborted/i.test(message)||e?.name==='TimeoutError'||e?.name==='AbortError'?'CJ_UPSTREAM_TIMEOUT':'CJ_REVIEW_UPSTREAM_ERROR';
    const status=kind==='CJ_AUTH_CONFIG_MISSING'||kind==='CJ_AUTH_FAILED'||kind==='CJ_AUTH_REJECTED'?503:kind==='CJ_PRODUCT_ID_MISMATCH'?502:kind==='CJ_REVIEW_EVIDENCE_UNAVAILABLE'?424:502;
    res.setHeader('Cache-Control','no-store');
    return res.status(status).json({ok:false,code:kind,upstreamStatus:Number.isInteger(e?.upstreamStatus)?e.upstreamStatus:null,stage:['auth','detail','reviews','review-score'].includes(e?.stage)?e.stage:null,reviewScore:e?.stage==='review-score'&&[1,2].includes(e?.reviewScore)?e.reviewScore:null,diagnosticReason:['cj_response_json_invalid','cj_response_envelope_unrecognized','cj_response_media_type_invalid','cj_review_score_total_invalid','cj_review_totals_invalid'].includes(e?.diagnosticReason)?e.diagnosticReason:null,error:'CJレビュー情報を検証できません。推薦を保留します。'});
  }
}
