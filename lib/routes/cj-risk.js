const BASE='https://developers.cjdropshipping.com/api2.0/v1';
let cached='',until=0;
async function token(){
  if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
  if(cached&&Date.now()<until)return cached;
  if(!process.env.CJ_API_KEY)throw Error('CJ_API_KEY is not configured');
  const r=await fetch(BASE+'/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:process.env.CJ_API_KEY})});
  const j=await r.json();
  if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error(j.message||'CJ authentication failed');
  cached=j.data.accessToken;until=Date.now()+12*60*60*1000;return cached;
}
async function getJson(url,headers){
  const r=await fetch(url,{headers});const j=await r.json();
  if(!r.ok||j.result!==true)throw Error(j.message||'CJ request failed');
  return j.data;
}
function scoreRisk({low,mid,total,rating}){
  if(!Number.isSafeInteger(low)||!Number.isSafeInteger(mid)||low<0||mid<0||low+mid>total)return {level:'unknown',label:'レビュー件数不整合',exclude:true,reason:'review-counts-invalid'};
  const lowRate=total>0?(low+mid)/total:0;
  const rated=Number.isFinite(rating)&&rating>0;
  if(!Number.isSafeInteger(total)||total<=0||!rated)return {level:'unknown',label:'レビュー根拠不足',exclude:true,reason:'review-evidence-insufficient'};
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
    const headers={'CJ-Access-Token':await token()};
    const detailUrl=new URL(BASE+'/product/query');detailUrl.searchParams.set('pid',id);
    const detail=await getJson(detailUrl,headers);

    const reviewUrl=new URL(BASE+'/product/productComments');
    reviewUrl.searchParams.set('pid',id);reviewUrl.searchParams.set('pageNum','1');reviewUrl.searchParams.set('pageSize','1');
    const all=await getJson(reviewUrl,headers);

    async function countByScore(score){
      const u=new URL(reviewUrl);u.searchParams.set('score',String(score));
      const d=await getJson(u,headers);
      const count=Number(d?.total);
      if(d?.total===undefined||d?.total===null||!Number.isSafeInteger(count)||count<0)throw Error('CJ review score count unavailable');
      return count;
    }
    const [score1,score2]=await Promise.all([countByScore(1),countByScore(2)]);
    const total=Number(all?.total??detail?.commentCount);
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
  }catch(e){return res.status(500).json({ok:false,error:e.message||'Risk check failed'})}
}
