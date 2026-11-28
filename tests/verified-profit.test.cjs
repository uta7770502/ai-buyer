const {test}=require('node:test');
const assert=require('node:assert/strict');
const {verifiedProfit}=require('../lib/verified-profit.cjs');
const good={salePriceJpy:2000,productCostJpy:800,shippingJpy:300,paymentFeeJpy:100,platformFeeJpy:100,plannedAdCostJpy:100,returnReserveJpy:100,costSourceVerified:true,jpShippingVerified:true,feesVerified:true};
test('computes final profit after all required deductions',()=>{
 const r=verifiedProfit(good);
 assert.equal(r.finalProfitJpy,500);
 assert.equal(r.verifiedContributionMarginPercent,25);
 assert.equal(r.finalProfitVerified,true);
});
test('missing verification fails closed',()=>{
 for(const k of ['costSourceVerified','jpShippingVerified','feesVerified']) {
  const r=verifiedProfit({...good,[k]:false});
  assert.equal(r.finalProfitVerified,false);
 }
});
test('missing, negative or nonfinite money fails closed',()=>{
 for(const value of [undefined,null,NaN,Infinity,-1]) {
  const r=verifiedProfit({...good,shippingJpy:value});
  assert.equal(r.finalProfitVerified,false);
 }
});
test('loss is calculated but must not qualify as recommendation',()=>{
 const r=verifiedProfit({...good,plannedAdCostJpy:1000});
 assert.equal(r.finalProfitVerified,true);
 assert.ok(r.finalProfitJpy<0);
});
