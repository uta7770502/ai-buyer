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
