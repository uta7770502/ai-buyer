import { getShopifyAuthContext } from '../shopify-auth-context.js';

const VERSION='2026-10';

function money(v){
  const n=Number(v);
  return Number.isFinite(n)&&n>=0?n:null;
}

// Read-only post-order verification of fees actually charged by Shopify Payments.
// This endpoint never captures/refunds/voids a payment and never changes an order.
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
  if(!admin||String(req.headers?.authorization||'')!=='Bearer '+admin)
    return res.status(401).json({ok:false,error:'Unauthorized'});

  const orderId=String(req.query?.orderId||'').trim();
  if(!/^\d{1,30}$/.test(orderId))return res.status(400).json({ok:false,error:'Numeric orderId required'});

  const auth=await getShopifyAuthContext(req);
  if(!auth.ok)return res.status(auth.status).json({ok:false,error:auth.error});

  const endpoint='https://'+auth.shop+'/admin/api/'+VERSION+'/graphql.json';
  const query=`query ActualTransactionFees($id:ID!){
    order(id:$id){
      id name currencyCode test
      transactions(first:50){
        id kind status gateway formattedGateway test
        amountSet{shopMoney{amount currencyCode}}
        fees{
          amount{amount currencyCode}
          flatFee{amount currencyCode}
          rate
          rateName
          type
          taxAmount{amount currencyCode}
        }
      }
    }
  }`;

  try{
    const r=await fetch(endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Shopify-Access-Token':auth.token},
      body:JSON.stringify({query,variables:{id:'gid://shopify/Order/'+orderId}}),
      signal:AbortSignal.timeout(10000)
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok||j?.errors?.length||!j?.data)throw Error('Shopify fee query failed');
    const order=j.data.order;
    if(!order)return res.status(404).json({ok:false,error:'Order not found'});
    const txs=Array.isArray(order.transactions)?order.transactions:[];
    const rows=[];
    let totalFee=0,feeCount=0,currency=null,currencyMismatch=false;
    for(const tx of txs){
      const fees=Array.isArray(tx?.fees)?tx.fees:[];
      let transactionFee=0;
      for(const fee of fees){
        const amount=money(fee?.amount?.amount);
        const code=String(fee?.amount?.currencyCode||'').trim().toUpperCase();
        if(amount===null||!code)continue;
        if(currency&&currency!==code)currencyMismatch=true;
        currency=currency||code;
        totalFee+=amount;transactionFee+=amount;feeCount++;
      }
      rows.push({
        transactionId:String(tx?.id||''),
        kind:String(tx?.kind||''),
        status:String(tx?.status||''),
        gateway:String(tx?.formattedGateway||tx?.gateway||''),
        test:tx?.test===true,
        feeCount:fees.length,
        feeAmount:Math.round(transactionFee*100)/100
      });
    }
    const shopCurrency=String(order.currencyCode||'').toUpperCase();
    const actualFeesVerified=feeCount>0&&!currencyMismatch&&currency===shopCurrency;
    return res.status(200).json({
      ok:true,readOnly:true,orderId,orderName:String(order.name||''),test:order.test===true,
      shopCurrency,transactionCount:txs.length,feeCount,
      actualPaymentFeeAmount:actualFeesVerified?Math.round(totalFee*100)/100:null,
      actualPaymentFeeCurrency:actualFeesVerified?currency:null,
      actualPaymentFeesVerified:actualFeesVerified,
      verificationReason:actualFeesVerified?'shopify_order_transaction_fees':'no_verified_shopify_payments_fees',
      rows,
      mutationPerformed:false
    });
  }catch{
    return res.status(503).json({ok:false,error:'Unable to verify Shopify transaction fees'});
  }
}
