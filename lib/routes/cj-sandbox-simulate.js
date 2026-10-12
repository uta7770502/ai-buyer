import crypto from 'node:crypto';
import {redis,linkedSandboxOrder} from '../sandbox-order.js';

function fingerprint(shop,id){return crypto.createHash('sha256').update(shop+':'+id).digest('hex')}
function simKey(shop,id,phase){return 'ai-buyer:sandbox-simulation:'+fingerprint(shop,id)+':'+phase}
function trackingKey(shop,id){return 'ai-buyer:sandbox-tracking:'+fingerprint(shop,id)}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=process.env.AI_BUYER_ADMIN_KEY;
  if(!admin||req.headers.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  if(process.env.CJ_SANDBOX_ORDER_ENABLED!=='true')return res.status(503).json({ok:false,error:'Sandbox is disabled'});
  const shop=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
  const id=String(req.body?.orderId||''),phase=req.body?.phase;
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||!/^\d{1,30}$/.test(id)||!['payment','tracking'].includes(phase))return res.status(400).json({ok:false,error:'Valid orderId and sandbox phase are required'});
  try{
    await linkedSandboxOrder(shop,id);
    const key=simKey(shop,id,phase);
    if(phase==='payment'){
      await redis(['SET',key,'done']);
      return res.status(200).json({ok:true,sandbox:true,phase,localSimulation:true,realPayment:false,realShipment:false});
    }
    const existing=await redis(['GET',trackingKey(shop,id)]);
    const track=typeof existing==='string'&&existing?existing:'SBX'+fingerprint(shop,id).slice(0,24).toUpperCase();
    await redis(['SET',trackingKey(shop,id),track]);
    await redis(['SET',key,'done']);
    return res.status(200).json({ok:true,sandbox:true,phase,localSimulation:true,trackingNumber:track,realPayment:false,realShipment:false});
  }catch(e){
    return res.status(503).json({ok:false,needsReview:false,automaticRetry:false,error:e.message||'Unable to prepare local sandbox simulation'});
  }
}
