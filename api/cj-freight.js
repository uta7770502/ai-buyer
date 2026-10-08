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
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
 try{
  const id=String(req.query.id||'').trim(),destination=String(req.query.destination||'JP').toUpperCase(),origin=String(req.query.origin||'CN').toUpperCase();
  if(!/^[a-zA-Z0-9:-]{1,100}$/.test(id)||!/^[A-Z]{2}$/.test(destination)||!/^[A-Z]{2}$/.test(origin))return res.status(400).json({ok:false,error:'Invalid product or country code'});
  const access=await token(),headers={'CJ-Access-Token':access};
  const detailUrl=new URL(BASE+'/product/query');detailUrl.searchParams.set('pid',id);
  const detailResponse=await fetch(detailUrl,{headers});const detail=await detailResponse.json();
  if(!detailResponse.ok||detail.result!==true)return res.status(502).json({ok:false,error:detail.message||'Product detail unavailable'});
  const p=detail.data||{},variants=Array.isArray(p.variants)?p.variants:Array.isArray(p.variantList)?p.variantList:[];
  const variantId=String(req.query.vid||'').trim();const v=variantId?variants.find(v=>String(v.vid||v.id||v.variantId)===variantId):variants.find(v=>v.vid||v.id||v.variantId);
  if(!v)return res.status(422).json({ok:false,error:'CJの商品バリエーションIDを取得できません。送料は手入力してください。'});
  const vid=String(v.vid||v.id||v.variantId);
  const quoteResponse=await fetch(BASE+'/logistic/freightCalculate',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({startCountryCode:origin,endCountryCode:destination,products:[{quantity:1,vid}]})});
  const quote=await quoteResponse.json();
  if(!quoteResponse.ok||quote.result!==true)return res.status(502).json({ok:false,error:quote.message||'CJ freight quote failed'});
  const options=(Array.isArray(quote.data)?quote.data:[]).map(x=>({name:String(x.logisticName||''),usd:Number(x.totalPostageFee??x.logisticPrice),days:String(x.logisticAging||'')})).filter(x=>Number.isFinite(x.usd)&&x.usd>=0).sort((a,b)=>a.usd-b.usd);
  if(!options.length)return res.status(422).json({ok:false,error:'この配送先の送料見積がありません。配送元やバリエーションを確認してください。'});
  res.setHeader('Cache-Control','private, no-store');
  return res.status(200).json({ok:true,origin,destination,vid,variants:variants.slice(0,50).filter(v=>v.vid||v.id||v.variantId).map(v=>({vid:String(v.vid||v.id||v.variantId),sku:String(v.variantSku||v.sku||''),name:String(v.variantNameEn||v.variantName||v.variantSku||'')})),variantSku:String(v.variantSku||v.sku||''),variantName:String(v.variantNameEn||v.variantName||''),options});
 }catch(e){return res.status(500).json({ok:false,error:e.message||'Freight quote failed'})}
}