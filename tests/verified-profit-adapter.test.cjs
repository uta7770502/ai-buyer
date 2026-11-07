const {test}=require('node:test');
const assert=require('node:assert/strict');
const {applyVerifiedProfit}=require('../lib/verified-profit-adapter.cjs');
const base={id:'sku1',finalProfitVerified:true,contributionMarginVerified:true,finalProfitJpy:9999,verifiedContributionMarginPercent:99};
const evidence=()=>({productId:'sku1',verifiedAt:new Date().toISOString(),currency:'JPY',shippingDestination:'JP',salePriceJpy:2000,productCostJpy:800,shippingJpy:300,paymentFeeJpy:100,platformFeeJpy:100,plannedAdCostJpy:100,returnReserveJpy:100,costSourceVerified:true,jpShippingVerified:true,feesVerified:true});
test('valid fresh JPY evidence replaces stale profit claims',()=>{const p=applyVerifiedProfit(base,evidence());assert.equal(p.finalProfitJpy,500);assert.equal(p.verifiedContributionMarginPercent,25);});
test('wrong product, destination, currency, or stale evidence fail closed',()=>{
 for(const patch of [{productId:'different'},{currency:'USD'},{shippingDestination:'US'},{verifiedAt:'2020-01-01T00:00:00Z'},{verifiedAt:'not-a-date'},{costSourceVerified:false}]) {
  const p=applyVerifiedProfit(base,{...evidence(),...patch});
  assert.notEqual(p.finalProfitVerified,true,JSON.stringify(patch));
  assert.equal(p.finalProfitJpy,undefined);
 }
});
