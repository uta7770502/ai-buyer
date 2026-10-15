function clean(v,max=500){return String(v||'').trim().slice(0,max)}
function positiveInt(v){const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:0}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const sellerName=clean(process.env.ODDLY_SELLER_NAME,160);
  const representative=clean(process.env.ODDLY_REPRESENTATIVE_NAME,160);
  const address=clean(process.env.ODDLY_SELLER_ADDRESS,300);
  const phone=clean(process.env.ODDLY_SUPPORT_PHONE,80);
  const email=clean(process.env.ODDLY_SUPPORT_EMAIL,160);
  const paymentTiming=clean(process.env.ODDLY_PAYMENT_TIMING,500);
  const shippingWindow=clean(process.env.ODDLY_SHIPPING_WINDOW,500);
  const returnDays=positiveInt(process.env.ODDLY_RETURN_DAYS);
  const returnConditions=clean(process.env.ODDLY_RETURN_CONDITIONS,1200);
  const returnShipping=clean(process.env.ODDLY_RETURN_SHIPPING,500);
  const additionalFees=clean(process.env.ODDLY_ADDITIONAL_FEES,500);
  const privacyContact=clean(process.env.ODDLY_PRIVACY_CONTACT||email,160);
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
    updatedAt:clean(process.env.ODDLY_POLICY_UPDATED_AT,40)
  });
}
