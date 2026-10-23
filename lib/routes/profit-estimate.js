// Admin-only deterministic profit estimator; no orders, payments, or currency conversion.
function amount(v){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100000000)return null;return v}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
 const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
 if(!admin||req.headers?.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
 const input=req.body||{};
 const keys=['salePrice','purchaseCost','shippingCost','paymentFee','platformFee','otherCost','expectedRefundLoss'];
 const values={};
 for(const k of keys){
  const v=input[k]??0;const n=amount(v);
  if(n===null)return res.status(400).json({ok:false,error:'Invalid monetary input: '+k});
  values[k]=n;
 }
 const currency=String(input.currency||'JPY').toUpperCase();
 if(!/^[A-Z]{3}$/.test(currency))return res.status(400).json({ok:false,error:'Invalid currency'});
 const costs=keys.filter(k=>k!=='salePrice').reduce((sum,k)=>sum+values[k],0);
 const profit=Number((values.salePrice-costs).toFixed(2));
 const margin=values.salePrice>0?Number((profit/values.salePrice*100).toFixed(2)):null;
 return res.status(200).json({ok:true,readOnly:true,currency,salePrice:values.salePrice,totalCosts:Number(costs.toFixed(2)),estimatedProfit:profit,marginPercent:margin,profitable:profit>0,inputs:values,warning:'All amounts must be entered in the same currency; estimates exclude unentered tax, FX changes and unmodeled returns.'});
}
