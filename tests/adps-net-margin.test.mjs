import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateNetMargin,evaluateMarginTiers} from '../lib/adps-net-margin.mjs';

const costs={priceYen:2000,costYen:1000,shippingYen:200,percentageFee:0.035,fixedFeeYen:0};
const verified={feeEvidenceVerified:true,shippingEvidenceVerified:true};
test('unverified fee and shipping always block recommendation',()=>{
  assert.equal(evaluateMarginTiers(costs).eligible,false);
  assert.equal(evaluateMarginTiers(costs,{feeEvidenceVerified:true}).eligible,false);
});
test('round fractional payment fee upward',()=>{
  assert.equal(calculateNetMargin({...costs,priceYen:101,percentageFee:0.035}).paymentFeeYen,4);
});
test('select 30, 25, 20 percent tier, or reject',()=>{
  assert.equal(evaluateMarginTiers(costs,verified).tier,0.30);
  assert.equal(evaluateMarginTiers({...costs,costYen:1150},verified).tier,0.25);
  assert.equal(evaluateMarginTiers({...costs,costYen:1250},verified).tier,0.20);
  assert.equal(evaluateMarginTiers({...costs,costYen:1400},verified).eligible,false);
});
test('reject invalid and fractional yen inputs',()=>{
  for(const value of [-1,0.1,NaN,Infinity])assert.equal(calculateNetMargin({...costs,shippingYen:value}).ok,false);
});

test('large but individually safe costs never overflow into an eligible margin',()=>{
 const huge={priceYen:2000,costYen:Number.MAX_SAFE_INTEGER,shippingYen:200,percentageFee:0.035};
 assert.deepEqual(calculateNetMargin(huge),{ok:false,reason:'unsafe-cost-total'});
 assert.equal(evaluateMarginTiers(huge,verified).eligible,false);
});
test('unsafe payment fee totals fail closed',()=>{
 const huge={priceYen:2000,costYen:100,shippingYen:200,fixedFeeYen:Number.MAX_SAFE_INTEGER,percentageFee:0.035};
 assert.equal(calculateNetMargin(huge).ok,false);
 assert.equal(evaluateMarginTiers(huge,verified).eligible,false);
});

test('every monetary field rejects missing, negative, fractional and unsafe values',()=>{
 for(const field of ['priceYen','costYen','shippingYen','advertisingYen','returnsReserveYen','fixedFeeYen']){
  for(const value of (['priceYen','costYen','shippingYen'].includes(field) ? [undefined,null,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1] : [null,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])){
   const input={...costs,advertisingYen:0,returnsReserveYen:0,fixedFeeYen:0,[field]:value};
   assert.equal(calculateNetMargin(input).ok,false,`${field}=${String(value)}`);
   assert.equal(evaluateMarginTiers(input,verified).eligible,false,`${field}=${String(value)}`);
  }
 }
});
test('fee rate cannot be missing, negative, nonfinite or 100 percent',()=>{
 for(const percentageFee of [null,-0.01,1,Infinity,NaN]){
  assert.equal(calculateNetMargin({...costs,percentageFee}).ok,false,String(percentageFee));
 }
});
test('fee rounding at 30 percent boundary never inflates margin',()=>{
 const input={priceYen:101,costYen:66,shippingYen:0,percentageFee:0.035,fixedFeeYen:0};
 const r=calculateNetMargin(input);
 assert.equal(r.paymentFeeYen,4);
 assert.equal(r.netProfitYen,31);
 assert.equal(evaluateMarginTiers(input,verified).tier,0.30);
 assert.equal(evaluateMarginTiers({...input,costYen:67},verified).tier,0.25);
});

test('omitted optional reserves and fee use zero, but never prove fee or freight evidence',()=>{
 const minimal={priceYen:2000,costYen:1000,shippingYen:200};
 assert.equal(calculateNetMargin(minimal).ok,true);
 assert.equal(evaluateMarginTiers(minimal).eligible,false);
 assert.equal(evaluateMarginTiers(minimal,{shippingEvidenceVerified:true}).eligible,false);
 assert.equal(evaluateMarginTiers(minimal,{feeEvidenceVerified:true}).eligible,false);
});

test('evidence must be explicit booleans, never truthy strings or numbers',()=>{
 for(const value of ['true','verified',1,{},[]]){
  assert.equal(evaluateMarginTiers(costs,{feeEvidenceVerified:value,shippingEvidenceVerified:true}).eligible,false);
  assert.equal(evaluateMarginTiers(costs,{feeEvidenceVerified:true,shippingEvidenceVerified:value}).eligible,false);
 }
 assert.equal(evaluateMarginTiers(costs,{feeEvidenceVerified:true,shippingEvidenceVerified:true}).eligible,true);
});
