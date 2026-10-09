import crypto from 'node:crypto';
import {redis,linkedSandboxOrder,simulateCj,trackingOf} from '../sandbox-order.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=process.env.AI_BUYER_ADMIN_KEY;
  if(!admin||req.headers.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  if(process.env.CJ_SANDBOX_ORDER_ENABLED!=='true')return res.status(503).json({ok:false,error:'Sandbox is disabled'});
  const shop=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
  const id=String(req.body?.orderId||''),phase=req.body?.phase;
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||!/^\d{1,30}$/.test(id)||!['payment','tracking'].includes(phase))return res.status(400).json({ok:false,error:'Valid orderId and sandbox phase are required'});
  let lock='';
  try{
    const {id:cjOrderId,data}=await linkedSandboxOrder(shop,id);
    const fingerprint=crypto.createHash('sha256').update(shop+':'+id).digest('hex');
    const key='ai-buyer:sandbox-simulation:'+fingerprint+':'+phase;
    const state=await redis(['GET',key]);
    if(state==='done')return res.status(200).json({ok:true,sandbox:true,skipped:true,phase});
    if(state!==null)return res.status(409).json({ok:false,needsReview:true,automaticRetry:false,error:'Previous simulation is unresolved; reconcile manually'});
    const status=String(data.orderStatus??data.status??'').toUpperCase();
    const paid=['PENDING','PROCESSING','UNSHIPPED','SHIPPED','DELIVERED'].includes(status)||/^(3\d\d|4\d\d|500|600|601)$/.test(status);
    if(phase==='payment'&&paid)return res.status(200).json({ok:true,sandbox:true,skipped:true,phase});
    if(phase==='payment'&&!['CREATED','IN_CART','UNPAID','100','101','200'].includes(status))return res.status(409).json({ok:false,error:'Sandbox order is not eligible for simulated payment'});
    if(phase==='tracking'&&!paid)return res.status(409).json({ok:false,error:'Simulated payment must be confirmed before adding tracking'});
    if(phase==='tracking'&&trackingOf(data))return res.status(200).json({ok:true,sandbox:true,skipped:true,phase});
    lock=key;
    const reserved=await redis(['SET',key,'reserved','NX']);
    if(reserved!== 'OK')return res.status(409).json({ok:false,needsReview:true,automaticRetry:false,error:'Sandbox action is already reserved'});
    try{
      await simulateCj(phase,cjOrderId,'SBX'+fingerprint.slice(0,24).toUpperCase());
      if(await redis(['SET',key,'done'])!=='OK')throw Error('Persistence failed');
    }catch{
      try{await redis(['SET',key,'needs_review:simulation_result_ambiguous'])}catch{}
      return res.status(202).json({ok:false,needsReview:true,automaticRetry:false,error:'Sandbox simulation result is uncertain; do not retry automatically'});
    }
    return res.status(200).json({ok:true,sandbox:true,phase,realPayment:false,realShipment:false});
  }catch{
    return res.status(503).json({ok:false,needsReview:Boolean(lock),automaticRetry:false,error:'Unable to verify sandbox order or persist simulation state'});
  }
}
