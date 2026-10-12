import crypto from 'node:crypto';
import {redis,linkedSandboxOrder,trackingOf} from '../sandbox-order.js';

function simKey(shop,id,phase){
  const fingerprint=crypto.createHash('sha256').update(shop+':'+id).digest('hex');
  return 'ai-buyer:sandbox-simulation:'+fingerprint+':'+phase;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  const admin=process.env.AI_BUYER_ADMIN_KEY;
  if(!admin||req.headers.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
  const shop=String(process.env.SHOPIFY_ALLOWED_SHOP_DOMAIN||'').trim().toLowerCase();
  const id=String(req.body?.orderId||'').trim();
  if(!/^\d{1,30}$/.test(id))return res.status(400).json({ok:false,error:'Valid orderId is required'});
  try{
    const {data}=await linkedSandboxOrder(shop,id);
    const status=String(data.orderStatus??data.status??'').toUpperCase();
    const tracking=trackingOf(data);
    const paid=['PENDING','PROCESSING','UNSHIPPED','SHIPPED','DELIVERED'].includes(status)||/^(3\d\d|4\d\d|500|600|601)$/.test(status);
    const unpaid=['CREATED','IN_CART','UNPAID','100','101','200'].includes(status);
    const out={payment:{},tracking:{}};

    const pk=simKey(shop,id,'payment');
    const ps=await redis(['GET',pk]);
    if(ps==='done')out.payment={state:'done'};
    else if(paid){await redis(['SET',pk,'done']);out.payment={state:'confirmed',resolved:true};}
    else if(unpaid&&typeof ps==='string'&&ps.startsWith('needs_review:')){
      await redis(['DEL',pk]);out.payment={state:'cleared',safeToRetry:true,resolved:true};
    }else out.payment={state:ps||'none',safeToRetry:false};

    const tk=simKey(shop,id,'tracking');
    const ts=await redis(['GET',tk]);
    if(ts==='done')out.tracking={state:'done'};
    else if(tracking){await redis(['SET',tk,'done']);out.tracking={state:'confirmed',resolved:true,trackingNumber:tracking};}
    else if(paid&&typeof ts==='string'&&ts.startsWith('needs_review:')){
      await redis(['DEL',tk]);out.tracking={state:'cleared',safeToRetry:true,resolved:true};
    }else out.tracking={state:ts||'none',safeToRetry:false};

    return res.status(200).json({ok:true,sandbox:true,status,trackingNumber:tracking||'',payment:out.payment,tracking:out.tracking});
  }catch(e){
    return res.status(503).json({ok:false,error:e.message||'Sandbox reconciliation failed'});
  }
}
