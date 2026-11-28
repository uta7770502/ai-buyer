import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateTargetSalePrice} from '../lib/target-price.js';
const base={productCostJpy:1000,shippingCostJpy:500,adCostPerOrderJpy:300,returnReserveJpy:150,paymentFixedFeeJpy:0,paymentFeeRatePercent:5,targetMarginPercent:30,shippingVerified:true};
test('automatically computes a price meeting 30 percent net margin',()=>{
 const result=calculateTargetSalePrice(base);
 assert.equal(result.ready,true);
 assert.equal(result.priceJpy,3000);
 assert.ok(result.estimatedMarginPercent>=30);
 assert.equal(result.verifiedForPublication,false);
});
test('higher freight raises target price',()=>{
 assert.ok(calculateTargetSalePrice({...base,shippingCostJpy:1000}).priceJpy>calculateTargetSalePrice(base).priceJpy);
});
test('missing or unverified freight blocks a final price',()=>{
 assert.equal(calculateTargetSalePrice({...base,shippingVerified:false}).ready,false);
 assert.equal(calculateTargetSalePrice({...base,shippingCostJpy:null}).ready,false);
});
test('only approved margin thresholds can be selected',()=>{
 assert.equal(calculateTargetSalePrice({...base,targetMarginPercent:10}).ready,false);
 assert.equal(calculateTargetSalePrice({...base,targetMarginPercent:25}).ready,true);
});

import fs from 'node:fs';
test('provisional ad-budget pricing blocks launch even when draft is prepared',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=html.indexOf('function launchEligibility(');
 const end=html.indexOf('function scaleEligibility(',start);
 const gate=html.slice(start,end);
 assert.match(gate,/priceEstimateOnly===true/);
 assert.match(gate,/広告費が暫定値のため公開承認不可/);
 assert.match(html,/x\.priceEstimateOnly=true/);
});
test('floating-point boundary never adds an unnecessary 100 yen',()=>{
 const r=calculateTargetSalePrice(base);
 assert.equal(r.priceJpy,3000);
});

test('fractional JPY payment fees are rounded up before verifying target margin',()=>{
 const r=calculateTargetSalePrice({...base,productCostJpy:1101,paymentFixedFeeJpy:13,paymentFeeRatePercent:3.6});
 assert.equal(r.ready,true);
 assert.equal(r.paymentFeeJpy,Math.ceil(r.priceJpy*0.036+13));
 assert.ok((r.priceJpy-1101-base.shippingCostJpy-base.adCostPerOrderJpy-base.returnReserveJpy-r.paymentFeeJpy)/r.priceJpy>=0.30-1e-12);
 assert.equal(r.verifiedForPublication,false);
});
test('price proposal rejects impossible combined payment fee and margin',()=>{
 assert.equal(calculateTargetSalePrice({...base,paymentFeeRatePercent:75,targetMarginPercent:30}).ready,false);
});

test('selected-product Shopify draft preparation reconciles rounded JPY fees',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=html.indexOf('async function autoPrepareSelectedProduct(');
 const end=html.indexOf('function resumeAutoPreparation(',start);
 const block=html.slice(start,end);
 assert.match(block,/Math\.ceil\(x\.price\*feeRate\/100\)/);
 assert.match(block,/actualProvisionalFee!==proposal\.paymentFeeJpy/);
 assert.match(block,/finalProfit<=0/);
 assert.match(block,/await autoPublishCandidate\(x\)/);
 assert.ok(block.indexOf('actualProvisionalFee!==proposal.paymentFeeJpy')<block.indexOf('await autoPublishCandidate(x)'));
});

test('draft price proposal rejects fractional or unsafe yen amounts',()=>{
 for(const field of ['productCostJpy','shippingCostJpy','adCostPerOrderJpy','returnReserveJpy','paymentFixedFeeJpy']){
  assert.equal(calculateTargetSalePrice({...base,[field]:1.5}).ready,false,field);
  assert.equal(calculateTargetSalePrice({...base,[field]:Number.MAX_SAFE_INTEGER+1}).ready,false,field);
 }
 assert.equal(calculateTargetSalePrice({...base,productCostJpy:100000001}).ready,false);
});
