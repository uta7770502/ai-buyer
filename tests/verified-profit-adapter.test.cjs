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

test('verified margin tiers are derived from trusted evidence, never client claims',()=>{
 const forged={...base,verifiedMarginEligible:true,verifiedMarginTier:30,marginExceptionReviewRequired:false};
 const cases=[[-100,30,false],[0,25,true],[150,null,false]];
 for(const [extraCost,tier,review] of cases){
   const result=applyVerifiedProfit(forged,{...evidence(),productCostJpy:800+extraCost});
   assert.equal(result.verifiedMarginTier,tier);
   assert.equal(result.verifiedMarginEligible,tier!==null);
   assert.equal(result.marginExceptionReviewRequired,review);
 }
 const rejected=applyVerifiedProfit(forged,{...evidence(),feesVerified:false});
 assert.equal(rejected.verifiedMarginEligible,false);
 assert.equal(rejected.verifiedMarginTier,null);
});

test('verified JPY profit refuses fractional yen and unsafe cost totals',()=>{
 const forged={...base,verifiedMarginEligible:true,verifiedMarginTier:30};
 for(const patch of [{paymentFeeJpy:1.5},{productCostJpy:Number.MAX_SAFE_INTEGER},{paymentFeeJpy:Number.MAX_SAFE_INTEGER}] ){
   const result=applyVerifiedProfit(forged,{...evidence(),...patch});
   assert.equal(result.finalProfitVerified,false,JSON.stringify(patch));
   assert.equal(result.verifiedMarginEligible,false);
   assert.equal(result.verifiedMarginTier,null);
 }
});
