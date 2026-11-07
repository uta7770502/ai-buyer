const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../lib/routes/preview-profit-audit.js'),'utf8');
test('draft audit does not assert independently verified profit',()=>{assert.match(source,/const contributionMarginVerified=false,finalProfitVerified=false;/);assert.match(source,/profitVerificationReason='cj_freight_and_actual_fees_not_verified'/);});
test('tier checks raw ratio, not rounded display margin',()=>{assert.match(source,/finalProfitJpy\/sale>=0\.30/);assert.match(source,/finalProfitJpy\/sale>=0\.25/);assert.match(source,/finalProfitJpy\/sale>=0\.20/);});

test('estimate tiers cannot authorize launch',()=>{assert.match(source,/const estimatedMarginTier=/);assert.match(source,/launchEconomicsEligible:false/);assert.match(source,/launchEconomicsEligible:0/);assert.match(source,/estimatedEconomicsEligible:/);assert.doesNotMatch(source,/recommendedMarginTier/);});

test('CJ freight quote is scoped to exact variant and Japan and remains informational',()=>{assert.match(source,/logistic\/freightCalculate/);assert.match(source,/endCountryCode:'JP'/);assert.match(source,/products:\[\{quantity:1,vid\}\]/);assert.match(source,/cjFreightVerified/);assert.match(source,/launchEconomicsEligible:false/);});

test('profit estimates require CJ freight and do not fall back to Shopify stored shipping',()=>{assert.match(source,/const auditShippingJpy=cjFreightVerified\?cjFreightJpy:null/);assert.match(source,/const assumptionsReady=auditShippingJpy!==null/);assert.match(source,/const grossProfit=auditShippingJpy===null\?null/);assert.match(source,/launchEconomicsEligible:false/);});

test('payment fee estimate requires explicit rate, fixed fee and platform fee',()=>{assert.match(source,/meta\.payment_fee_rate_percent/);assert.match(source,/meta\.payment_fixed_fee_jpy/);assert.match(source,/meta\.platform_fee_per_order_jpy/);assert.match(source,/paymentFeeAssumptionsReady\?/);assert.match(source,/paymentFeeSource:'shopify-metafield-assumptions-not-verified'/);assert.doesNotMatch(source,/Math\.round\(sale\*0\.045\)/);});

test('standard 30 percent and exception 25/20 percent are separate, never launch authorization',()=>{assert.match(source,/estimatedEconomicsEligible:estimatedMarginTier===30/);assert.match(source,/estimatedExceptionReviewEligible:estimatedMarginTier===25\|\|estimatedMarginTier===20/);assert.match(source,/launchEconomicsEligible:false/);});
