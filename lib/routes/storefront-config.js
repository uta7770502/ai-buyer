import { loadLegalConfig, saveLegalConfig } from '../legal-config-store.js';
function clean(v,max=500){return String(v||'').trim().slice(0,max)}
function returnDaysValue(v){const n=Number(v);return Number.isSafeInteger(n)&&n>=1&&n<=365?n:0}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Method not allowed'});
  if(req.method==='POST'){
    const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
    if(!admin||req.headers?.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  }
  let stored=null;
  try{stored=await loadLegalConfig()}catch{
    return res.status(503).json({ok:false,legalReady:false,code:'LEGAL_CONFIG_READ_FAILED',error:'保存済みの法務情報を読み取れませんでした。未入力とは限りません。保存先と暗号化設定を確認してから再試行してください。'});
  }
  if(req.method==='POST'){
    const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
    if(!admin||req.headers?.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
    const body=req.body||{};
    const candidate={
      sellerName:clean(body.sellerName,160),
      representative:clean(body.representative,160),
      address:clean(body.address,300),
      phone:clean(body.phone,80),
      email:clean(body.email,160),
      paymentTiming:clean(body.paymentTiming,500),
      shippingWindow:clean(body.shippingWindow,500),
      returnDays:returnDaysValue(body.returnDays),
      returnConditions:clean(body.returnConditions,1200),
      returnShipping:clean(body.returnShipping,500),
      additionalFees:clean(body.additionalFees,500),
      privacyContact:clean(body.privacyContact||body.email,160)
    };
    const requiredOk=Boolean(candidate.sellerName&&candidate.representative&&candidate.address&&candidate.phone&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email)&&candidate.paymentTiming&&candidate.shippingWindow&&candidate.returnDays>0&&candidate.returnConditions&&candidate.returnShipping&&candidate.additionalFees&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.privacyContact));
    if(!requiredOk)return res.status(400).json({ok:false,error:'法務情報に未入力または形式不正の項目があります'});
    try{await saveLegalConfig(candidate)}catch(e){return res.status(503).json({ok:false,error:e.message||'法務情報を保存できませんでした'})}
    stored=candidate;
  }
  const sellerName=clean(stored?.sellerName||process.env.ODDLY_SELLER_NAME,160);
  const representative=clean(stored?.representative||process.env.ODDLY_REPRESENTATIVE_NAME,160);
  const address=clean(stored?.address||process.env.ODDLY_SELLER_ADDRESS,300);
  const phone=clean(stored?.phone||process.env.ODDLY_SUPPORT_PHONE,80);
  const email=clean(stored?.email||process.env.ODDLY_SUPPORT_EMAIL,160);
  const paymentTiming=clean(stored?.paymentTiming||process.env.ODDLY_PAYMENT_TIMING,500);
  const shippingWindow=clean(stored?.shippingWindow||process.env.ODDLY_SHIPPING_WINDOW,500);
  const returnDays=returnDaysValue(stored?.returnDays||process.env.ODDLY_RETURN_DAYS);
  const returnConditions=clean(stored?.returnConditions||process.env.ODDLY_RETURN_CONDITIONS,1200);
  const returnShipping=clean(stored?.returnShipping||process.env.ODDLY_RETURN_SHIPPING,500);
  const additionalFees=clean(stored?.additionalFees||process.env.ODDLY_ADDITIONAL_FEES,500);
  const privacyContact=clean(stored?.privacyContact||process.env.ODDLY_PRIVACY_CONTACT||email,160);
  const required={
    sellerName:Boolean(sellerName),
    representative:Boolean(representative),
    address:Boolean(address),
    phone:Boolean(phone),
    email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    paymentTiming:Boolean(paymentTiming),
    shippingWindow:Boolean(shippingWindow),
    returnDays:returnDays>0,
    returnConditions:Boolean(returnConditions),
    returnShipping:Boolean(returnShipping),
    additionalFees:Boolean(additionalFees),
    privacyContact:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacyContact)
  };
  const legalReady=Object.values(required).every(Boolean);
  return res.status(200).json({
    ok:true,
    checkoutEnabled:String(process.env.ODDLY_CHECKOUT_ENABLED||'').toLowerCase()==='true',
    legalReady,
    required,
    commerce:{sellerName,representative,address,phone,email,paymentTiming,shippingWindow,returnDays,returnConditions,returnShipping,additionalFees},
    privacy:{contact:privacyContact},
    updatedAt:clean(stored?.updatedAt||process.env.ODDLY_POLICY_UPDATED_AT,40),source:stored?'encrypted-redis':'environment'
  });
}
