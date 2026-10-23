import {getUsdJpyRate} from '../server-fx.js';
import {estimateProfitFromServerFreight} from '../server-profit-from-freight.js';
const BASE='https://developers.cjdropshipping.com/api2.0/v1';
let cached='',expires=0;
async function token(){
 if(process.env.CJ_ACCESS_TOKEN)return process.env.CJ_ACCESS_TOKEN;
 if(cached&&Date.now()<expires)return cached;
 if(!process.env.CJ_API_KEY)throw Error('CJ_API_KEY is not configured');
 const r=await fetch(BASE+'/authentication/getAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:process.env.CJ_API_KEY})});
 const j=await r.json();if(!r.ok||j.result!==true||!j.data?.accessToken)throw Error(j.message||'CJ authentication failed');
 cached=j.data.accessToken;expires=Date.now()+12*60*60*1000;return cached;
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function cjFetch(url,options={}){
 let last;
 for(let attempt=0;attempt<5;attempt++){
  if(attempt)await delay(1350*attempt);
  const response=await fetch(url,options);
  const data=await response.json();
  const message=String(data?.message||data?.error||'');
  if(response.status!==429&&!/too many requests|qps limit|rate limit/i.test(message))return {response,data};
  last=message||'CJ rate limit';
 }
 throw Error('CJアクセス集中のため送料確認を完了できませんでした。少し待って再試行してください。'+(last?' '+last:''));
}
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
 try{
  let id=String(req.query.id||'').trim();
  const destination=String(req.query.destination||'JP').toUpperCase(),origin=String(req.query.origin||'CN').toUpperCase();
  const variantId=String(req.query.vid||'').trim();
  if((id&&!/^[a-zA-Z0-9:-]{1,100}$/.test(id))||(variantId&&!/^[a-zA-Z0-9:-]{1,100}$/.test(variantId))||(!id&&!variantId)||!['JP','US','GB','AU','DE'].includes(destination)||origin!=='CN')return res.status(400).json({ok:false,error:'Invalid product, variant or shipping country'});
  const access=await token(),headers={'CJ-Access-Token':access};
  if(!id&&variantId){
    const variantUrl=new URL(BASE+'/product/variant/queryByVid');variantUrl.searchParams.set('vid',variantId);
    const {response:variantResponse,data:variantData}=await cjFetch(variantUrl,{headers});
    if(!variantResponse.ok||variantData.result!==true||!variantData.data?.pid)return res.status(502).json({ok:false,error:variantData.message||'CJ variant lookup failed'});
    id=String(variantData.data.pid);
  }
  const detailUrl=new URL(BASE+'/product/query');detailUrl.searchParams.set('pid',id);
  const {response:detailResponse,data:detail}=await cjFetch(detailUrl,{headers});
  if(!detailResponse.ok||detail.result!==true)return res.status(502).json({ok:false,error:detail.message||'Product detail unavailable'});
  const p=detail.data||{},variants=(Array.isArray(p.variants)?p.variants:Array.isArray(p.variantList)?p.variantList:[]).filter(v=>v&&typeof v==='object');
  const validVariants=variants.filter(v=>v.vid||v.id||v.variantId);
  if(!variantId&&validVariants.length>1)return res.status(422).json({ok:false,error:'複数のCJバリエーションがあります。色・サイズを選択してから送料を見積もってください。'});
  const v=variantId?validVariants.find(v=>String(v.vid||v.id||v.variantId)===variantId):validVariants[0];
  if(!v)return res.status(422).json({ok:false,error:'CJの商品バリエーションIDを取得できません。送料は手入力してください。'});
  const vid=String(v.vid||v.id||v.variantId);
  await delay(1200);
  const {response:quoteResponse,data:quote}=await cjFetch(BASE+'/logistic/freightCalculate',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({startCountryCode:origin,endCountryCode:destination,products:[{quantity:1,vid}]})});
  if(!quoteResponse.ok||quote.result!==true)return res.status(502).json({ok:false,error:quote.message||'CJ freight quote failed'});
  const options=(Array.isArray(quote.data)?quote.data:[]).filter(x=>x&&typeof x==='object').map(x=>{const raw=x.totalPostageFee??x.logisticPrice;return {name:String(x.logisticName||'配送方法未指定'),usd:raw===null||raw===undefined||String(raw).trim()===''?NaN:Number(raw),days:String(x.logisticAging||'')}}).filter(x=>Number.isFinite(x.usd)&&x.usd>=0&&x.usd<=100000).sort((a,b)=>a.usd-b.usd);
  if(!options.length)return res.status(422).json({ok:false,error:'この配送先の送料見積がありません。配送元やバリエーションを確認してください。'});
  const fx=destination==='JP'?await getUsdJpyRate():{verified:false,usdJpyRate:null,fxVerifiedAt:null};
  const fxReady=destination==='JP'&&fx.verified===true;
  const pricedOptions=options.map(o=>({...o,jpy:fxReady?Math.ceil(o.usd*fx.usdJpyRate):null}));
  const freightResult={ok:true,quoteSource:'cj-server',currency:'USD',shippingJpyVerified:fxReady,shippingCostJpy:fxReady?pricedOptions[0].jpy:null,fxVerified:fxReady,fxVerifiedAt:fxReady?fx.fxVerifiedAt:null,usdJpyRate:fxReady?fx.usdJpyRate:null,fxSource:fxReady?fx.fxSource:null,fetchedAt:new Date().toISOString(),destination,vid,options:pricedOptions};
  const profitPreview=req.query.profitPreview==='1';
  const profit=profitPreview?estimateProfitFromServerFreight(freightResult,{
    salePriceJpy:req.query.salePriceJpy,productCostJpy:req.query.productCostJpy,
    paymentFeeRatePercent:req.query.paymentFeeRatePercent,paymentFixedFeeJpy:req.query.paymentFixedFeeJpy,
    adCostPerOrderJpy:req.query.adCostPerOrderJpy,returnReservePerOrderJpy:req.query.returnReservePerOrderJpy
  },{expectedVid:vid}):null;
  res.setHeader('Cache-Control','private, no-store');
  return res.status(200).json({ok:true,quoteSource:'cj-server',currency:'USD',shippingJpyVerified:fxReady,shippingCostJpy:fxReady?pricedOptions[0].jpy:null,fxVerified:fxReady,fxVerifiedAt:fxReady?fx.fxVerifiedAt:null,usdJpyRate:fxReady?fx.usdJpyRate:null,fxSource:fxReady?fx.fxSource:null,quoteExpiresInSeconds:900,fetchedAt:new Date().toISOString(),origin,destination,vid,variants:variants.slice(0,50).filter(v=>v.vid||v.id||v.variantId).map(v=>({vid:String(v.vid||v.id||v.variantId),sku:String(v.variantSku||v.sku||''),name:String(v.variantNameEn||v.variantName||v.variantSku||'')})),variantSku:String(v.variantSku||v.sku||''),variantName:String(v.variantNameEn||v.variantName||''),options:pricedOptions,...(profitPreview?{profitPreview:profit}:{} )});
 }catch(e){return res.status(500).json({ok:false,error:e.message||'Freight quote failed'})}
}