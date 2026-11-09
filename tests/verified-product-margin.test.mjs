import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const profit=readFileSync(new URL('../lib/profit-estimate.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../lib/server-profit-from-freight.js',import.meta.url),'utf8').replace("'./profit-estimate.js'",JSON.stringify('data:text/javascript,'+encodeURIComponent(profit)));
const verifier=readFileSync(new URL('../lib/verified-product-margin.js',import.meta.url),'utf8').replace("'./server-profit-from-freight.js'",JSON.stringify('data:text/javascript,'+encodeURIComponent(server)));
const {assessVerifiedProductMargin}=await import('data:text/javascript,'+encodeURIComponent(verifier));
const now=Date.parse('2026-11-09T00:00:00Z'),at=new Date(now-1000).toISOString();
const input={
 expectedVid:'1234567890123',salePriceJpy:3000,threshold:30,
 freight:{ok:true,quoteSource:'cj-server',destination:'JP',currency:'USD',vid:'1234567890123',shippingJpyVerified:true,fxVerified:true,fxSource:'open.er-api.com',fetchedAt:at,fxVerifiedAt:at,shippingCostJpy:600,usdJpyRate:150,options:[{usd:4,jpy:600}]},
 supplier:{source:'cj-settled-cost',currency:'JPY',verified:true,vid:'1234567890123',costJpy:800,verifiedAt:at},
 fees:{source:'shopify-payment-settings',currency:'JPY',verified:true,verifiedAt:at,ratePercent:3.6,fixedJpy:0},
 advertising:{source:'approved-ad-budget',approved:true,costPerOrderJpy:300},
 returns:{source:'approved-return-reserve',approved:true,reserveJpy:100}
};
test('fully evidenced 30 percent product passes server-side margin gate',()=>{const x=assessVerifiedProductMargin(input,{now});assert.equal(x.approved,true);assert.equal(x.profitJpy,1092);assert.equal(x.marginPercent,36.4)});
test('CJ selected variant quote is not a settled supplier cost',()=>{const x=assessVerifiedProductMargin({...input,supplier:{...input.supplier,source:'cj-selected-variant'}},{now});assert.equal(x.approved,false);assert.equal(x.finalProfitVerified,false)});
test('missing payment, ad budget and returns approval each block',()=>{for(const changes of [{fees:{...input.fees,verified:false}},{advertising:{...input.advertising,approved:false}},{returns:{...input.returns,approved:false}}])assert.equal(assessVerifiedProductMargin({...input,...changes},{now}).approved,false)});
test('expired cost and wrong variant cannot be approved',()=>{assert.equal(assessVerifiedProductMargin({...input,supplier:{...input.supplier,verifiedAt:new Date(now-3600000).toISOString()}},{now}).approved,false);assert.equal(assessVerifiedProductMargin({...input,expectedVid:'different'},{now}).approved,false)});
test('30 percent fails when 25 percent may pass only with product-specific exception',()=>{const data={...input,advertising:{...input.advertising,costPerOrderJpy:550}};assert.equal(assessVerifiedProductMargin(data,{now}).approved,false);assert.equal(assessVerifiedProductMargin({...data,threshold:25},{now}).approved,false);const marginException={approved:true,source:'product-specific-owner-approval',vid:input.expectedVid,threshold:25,approvedAt:at,approvalId:'approval-test-123'};assert.equal(assessVerifiedProductMargin({...data,threshold:25,marginException},{now}).approved,true);assert.equal(assessVerifiedProductMargin({...data,threshold:25,marginException:{...marginException,vid:'other'}},{now}).approved,false);assert.equal(assessVerifiedProductMargin({...data,threshold:19},{now}).approved,false)});

test('expired payment fee evidence and fractional budget amounts are rejected',()=>{
 assert.equal(assessVerifiedProductMargin({...input,fees:{...input.fees,verifiedAt:new Date(now-25*60*60*1000).toISOString()}},{now}).approved,false);
 assert.equal(assessVerifiedProductMargin({...input,advertising:{...input.advertising,costPerOrderJpy:1.5}},{now}).approved,false);
 assert.equal(assessVerifiedProductMargin({...input,returns:{...input.returns,reserveJpy:-1}},{now}).approved,false);
 assert.equal(assessVerifiedProductMargin({...input,salePriceJpy:3000.5},{now}).approved,false);
});

test('missing or mismatched currencies cannot certify a final margin',()=>{
 assert.equal(assessVerifiedProductMargin({...input,supplier:{...input.supplier,currency:'USD'}},{now}).approved,false);
 assert.equal(assessVerifiedProductMargin({...input,supplier:{...input.supplier,currency:undefined}},{now}).approved,false);
 assert.equal(assessVerifiedProductMargin({...input,fees:{...input.fees,currency:'USD'}},{now}).approved,false);
});

test('margin exception requires fresh dated traceable owner approval',()=>{
 const data={...input,threshold:25};
 const approval={approved:true,source:'product-specific-owner-approval',vid:input.expectedVid,threshold:25,approvedAt:at,approvalId:'approval-test-123'};
 assert.equal(assessVerifiedProductMargin({...data,marginException:{...approval,approvalId:undefined}},{now}).approved,false);
 assert.equal(assessVerifiedProductMargin({...data,marginException:{...approval,approvedAt:undefined}},{now}).approved,false);
 assert.equal(assessVerifiedProductMargin({...data,marginException:{...approval,approvedAt:new Date(now-31*86400000).toISOString()}},{now}).approved,false);
});

test('20 percent exception is SKU-scoped and cannot be reused at 25 percent',()=>{
 const data={...input,advertising:{...input.advertising,costPerOrderJpy:750}};
 const approval={approved:true,source:'product-specific-owner-approval',vid:input.expectedVid,threshold:20,approvedAt:at,approvalId:'approval-test-20'};
 assert.equal(assessVerifiedProductMargin({...data,threshold:30},{now}).approved,false);
 assert.equal(assessVerifiedProductMargin({...data,threshold:20},{now}).approved,false);
 assert.equal(assessVerifiedProductMargin({...data,threshold:20,marginException:approval},{now}).approved,true);
 assert.equal(assessVerifiedProductMargin({...data,threshold:25,marginException:approval},{now}).approved,false);
 assert.equal(assessVerifiedProductMargin({...data,threshold:20,marginException:{...approval,vid:'other-variant'}},{now}).approved,false);
 assert.equal(assessVerifiedProductMargin({...data,threshold:20,marginException:{...approval,source:'browser-approval'}},{now}).approved,false);
 assert.equal(assessVerifiedProductMargin({...data,threshold:20,marginException:{...approval,approvedAt:new Date(now+1000).toISOString()}},{now}).approved,false);
});
