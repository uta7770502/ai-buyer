import test from 'node:test';
import assert from 'node:assert/strict';
import profit from '../lib/routes/profit-estimate.js';
import triage from '../lib/routes/return-triage.js';
function response(){return {statusCode:200,setHeader(){return this},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}}}
async function run(handler,method,body,authorization){
 const res=response();
 await handler({method,body,headers:authorization?{authorization}:{},query:{}},res);
 return res;
}
test('financial and return diagnostics reject unauthenticated requests',async()=>{
 const old=process.env.AI_BUYER_ADMIN_KEY;process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 try{
  assert.equal((await run(profit,'POST',{salePrice:1000})).statusCode,401);
  assert.equal((await run(triage,'POST',{type:'damaged'})).statusCode,401);
 }finally{if(old===undefined)delete process.env.AI_BUYER_ADMIN_KEY;else process.env.AI_BUYER_ADMIN_KEY=old}
});
test('profit estimate subtracts costs and refund risk without side effects',async()=>{
 const old=process.env.AI_BUYER_ADMIN_KEY;process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 try{
  const res=await run(profit,'POST',{salePrice:1000,purchaseCost:400,shippingCost:100,paymentFee:30,expectedRefundLoss:20},'Bearer test-only-secret');
  assert.equal(res.statusCode,200);assert.equal(res.body.estimatedProfit,450);assert.equal(res.body.marginPercent,45);assert.equal(res.body.readOnly,true);
 }finally{if(old===undefined)delete process.env.AI_BUYER_ADMIN_KEY;else process.env.AI_BUYER_ADMIN_KEY=old}
});
test('return triage flags out-of-window cases and never triggers refunds',async()=>{
 const old=process.env.AI_BUYER_ADMIN_KEY;process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 try{
  const res=await run(triage,'POST',{type:'damaged',daysSinceDelivery:15,returnWindowDays:7},'Bearer test-only-secret');
  assert.equal(res.statusCode,200);assert.equal(res.body.policyReviewRequired,true);assert.equal(res.body.refundIssued,false);assert.equal(res.body.customerMessageSent,false);
 }finally{if(old===undefined)delete process.env.AI_BUYER_ADMIN_KEY;else process.env.AI_BUYER_ADMIN_KEY=old}
});
