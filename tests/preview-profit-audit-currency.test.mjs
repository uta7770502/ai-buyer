import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync(new URL('../lib/routes/preview-profit-audit.js',import.meta.url),'utf8');
test('read-only CJ cost audit rejects missing or non-USD supplier currency',()=>{
 assert.match(route,/declaredSupplierCurrency!=='USD'/);
 assert.match(route,/d\?\.currency\|\|d\?\.currencyCode\|\|d\?\.priceCurrency/);
});
test('read-only CJ freight audit accepts only explicit USD quote options',()=>{
 assert.match(route,/return currency==='USD'/);
 assert.match(route,/contributionMarginVerified=false,finalProfitVerified=false/);
});

test('audit exposes per-SKU source evidence and never promotes quotes to final profit',()=>{
 for(const fragment of ["settledCostVerified:false","paymentFees:{source:'shopify-metafield-assumptions',verified:false}","recommendationEligible:false","finalProfitEvidenceReady:false","profitEvidence,supplierQuoteVerified:true"])assert.ok(route.includes(fragment),fragment);
});

test('aggregate audit never labels supplier quotes as settled costs',()=>{
 for(const fragment of ['supplierQuoteChecked:','settledSupplierCostVerified:0','shopifyPaymentFeesVerified:0','finalProfitEvidenceReady:false','supplierQuoteVerified:true'])assert.ok(route.includes(fragment),fragment);
});

test('preflight is read-only and does not claim profit evidence readiness',()=>{
 for(const fragment of ["req.query?.preflight==='1'","shopifyDraftQueryVerified:false","cjAuthenticationVerified:false","readyForVerifiedProfit:false"])assert.ok(route.includes(fragment),fragment);
 assert.ok(route.indexOf("req.query?.preflight==='1'")>route.indexOf("Admin authorization required"));
});

test('audit reads approved margin exception from server Redis but never marks final economics verified',()=>{
 for(const fragment of ["import {loadMarginException} from '../server-margin-exception.js'","await loadMarginException(vid)","storedMarginException.threshold===estimatedMarginTier","marginExceptionApproved","launchEconomicsEligible:false","contributionMarginVerified=false,finalProfitVerified=false"])assert.ok(route.includes(fragment),fragment);
});

test('profit audit exposes fee-inclusive 30/25/20 price scenarios without launch approval',()=>{
 for(const fragment of ['requiredSalePriceByMargin','scenarioInputsReady','configuredFeeRate/100-target/100','plannedAds+returnReserve','Math.ceil(price*configuredFeeRate/100+configuredFixedFee+configuredPlatformFee)','launchEconomicsEligible:false'])assert.ok(route.includes(fragment),fragment);
});

test('payment assumptions reject unsafe rates and non-integer fee budgets',()=>{
 for(const fragment of ['configuredFeeRate<70','Number.isSafeInteger(configuredFixedFee)','Number.isSafeInteger(configuredPlatformFee)','Number.isSafeInteger(plannedAds)','Number.isSafeInteger(returnReserve)','Number.isSafeInteger(auditShippingJpy)'])assert.ok(route.includes(fragment),fragment);
 assert.ok(route.includes("paymentFeeSource:'shopify-metafield-assumptions-not-verified'"));
});

test('preflight checks authenticated Shopify shop currency without claiming fee verification',()=>{
 assert.ok(route.includes("shopData?.shop?.currencyCode==='JPY'"));
 assert.ok(route.includes("shopData?.shop?.myshopifyDomain===auth.shop"));
 assert.ok(route.includes('checks.shopifyCurrencyJpyVerified=false'));
 assert.ok(route.includes('shopifyPaymentFeeSourceConfigured:false'));
 assert.ok(route.includes('readyForVerifiedProfit:false'));
});
