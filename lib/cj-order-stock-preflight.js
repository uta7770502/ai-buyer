import {validateCJStockResponse} from './cj-stock-validation.js';

// Recheck every distinct variant immediately before order preparation.
// Factory inventory is a planning signal, not a promise of dispatch or stock reservation.
export async function verifyOrderStock(products,{base,headers,fetcher=fetch}={}){
 const quantities=new Map();
 if(!Array.isArray(products)||products.length===0||products.length>100)return {ok:false,reason:'invalid-order-stock-input',rows:[]};
 for(const p of products){
  if(typeof p?.vid!=='string'||! /^[A-Za-z0-9_-]{6,100}$/.test(p.vid)||!Number.isSafeInteger(p.quantity)||p.quantity<1)return {ok:false,reason:'invalid-order-stock-input',rows:[]};
  const sum=(quantities.get(p.vid)||0)+p.quantity;
  if(!Number.isSafeInteger(sum))return {ok:false,reason:'invalid-order-stock-input',rows:[]};
  quantities.set(p.vid,sum);
 }
 if(!quantities.size)return {ok:false,reason:'invalid-order-stock-input',rows:[]};
 const rows=[];
 for(const [vid,quantity] of quantities){
  let stock;
  try{
   const r=await fetcher(base+'/product/stock/queryByVid?vid='+encodeURIComponent(vid),{headers,signal:AbortSignal.timeout(8000)});
   if(r.status===429)return {ok:false,reason:'stock-unverified',diagnostic:'cj-rate-limited',rows};
   stock=r.ok?validateCJStockResponse(await r.json()):null;
  }catch{stock=null}
  if(!stock?.ok)return {ok:false,reason:'stock-unverified',rows};
  const direct=stock.total>=quantity;
  const factory=!direct&&stock.factoryTotal>=quantity-stock.total;
  rows.push({vid,quantity,cjStock:stock.total,factoryStock:stock.factoryTotal,immediateQuantitySufficient:direct,requiresFactoryReplenishment:factory,dispatchPlanningWindow:factory?{minBusinessDays:3,maxBusinessDays:7,guaranteed:false}:null});
  if(!direct&&!factory)return {ok:false,reason:'insufficient-stock',rows};
 }
 return {ok:true,immediateEligible:rows.every(r=>r.immediateQuantitySufficient),requiresFactoryReplenishment:rows.some(r=>r.requiresFactoryReplenishment),rows};
}
