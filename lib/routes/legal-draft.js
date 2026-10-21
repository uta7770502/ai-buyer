import {saveLegalDraft,loadLegalDraft,clearLegalDraft,loadLegalConfig} from '../legal-config-store.js';
const FIELDS=['sellerName','representative','address','phone','email','paymentTiming','shippingWindow','returnDays','returnConditions','returnShipping','additionalFees','privacyContact'];
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST','DELETE'].includes(req.method))return res.status(405).json({ok:false,error:'Method not allowed'});
 const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
 if(!admin||req.headers?.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
 try{
  if(req.method==='GET'){
   const draft=await loadLegalDraft();
   return res.status(200).json({ok:true,draft:draft?.fields||null,updatedAt:draft?.updatedAt||null});
  }
  if(req.method==='DELETE'){
   await clearLegalDraft();
   return res.status(200).json({ok:true,deleted:true});
  }
  const formal=await loadLegalConfig();
  if(formal)return res.status(409).json({ok:false,error:'Formal legal configuration already exists; draft overwrite is disabled'});
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body))return res.status(400).json({ok:false,error:'Invalid draft'});
  const fields={};
  for(const key of FIELDS){
   const value=body[key];
   if(value!==undefined&&typeof value!=='string'&&typeof value!=='number')return res.status(400).json({ok:false,error:'Invalid field type'});
   fields[key]=String(value??'').trim().slice(0,key==='returnConditions'?1200:500);
  }
  await saveLegalDraft(fields);
  return res.status(200).json({ok:true,saved:true});
 }catch{
  return res.status(503).json({ok:false,error:'Encrypted draft storage unavailable'});
 }
}
