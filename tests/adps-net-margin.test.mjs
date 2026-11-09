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
