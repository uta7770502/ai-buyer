const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../lib/routes/preview-profit-audit.js'),'utf8');
test('draft audit does not assert independently verified profit',()=>{assert.match(source,/const contributionMarginVerified=false,finalProfitVerified=false;/);assert.match(source,/const profitVerificationReason=!cjFreightVerified/);assert.match(source,/actual_payment_fees_not_verified/);});
test('tier checks raw ratio, not rounded display margin',()=>{assert.match(source,/finalProfitJpy\/sale>=0\.30/);assert.match(source,/finalProfitJpy\/sale>=0\.25/);assert.match(source,/finalProfitJpy\/sale>=0\.20/);});

test('estimate tiers cannot authorize launch',()=>{assert.match(source,/const estimatedMarginTier=/);assert.match(source,/launchEconomicsEligible:false/);assert.match(source,/launchEconomicsEligible:0/);assert.match(source,/estimatedEconomicsEligible:/);assert.doesNotMatch(source,/recommendedMarginTier/);});

test('CJ freight quote is scoped to exact variant and Japan and remains informational',()=>{assert.match(source,/logistic\/freightCalculate/);assert.match(source,/endCountryCode:'JP'/);assert.match(source,/products:\[\{quantity:1,vid\}\]/);assert.match(source,/cjFreightVerified/);assert.match(source,/launchEconomicsEligible:false/);});

test('profit estimates require CJ freight and do not fall back to Shopify stored shipping',()=>{assert.match(source,/const auditShippingJpy=cjFreightVerified\?cjFreightJpy:null/);assert.match(source,/const assumptionsReady=auditShippingJpy!==null/);assert.match(source,/const grossProfit=auditShippingJpy===null\?null/);assert.match(source,/launchEconomicsEligible:false/);});

test('payment fee estimate requires explicit rate, fixed fee and platform fee',()=>{assert.match(source,/meta\.payment_fee_rate_percent/);assert.match(source,/meta\.payment_fixed_fee_jpy/);assert.match(source,/meta\.platform_fee_per_order_jpy/);assert.match(source,/paymentFeeAssumptionsReady\?/);assert.match(source,/paymentFeeSource:'shopify-metafield-assumptions-not-verified'/);assert.doesNotMatch(source,/Math\.round\(sale\*0\.045\)/);});

test('standard 30 percent and exception 25/20 percent are separate, never launch authorization',()=>{assert.match(source,/estimatedEconomicsEligible:estimatedMarginTier===30/);assert.match(source,/estimatedExceptionReviewEligible:estimatedMarginTier===25\|\|estimatedMarginTier===20/);assert.match(source,/launchEconomicsEligible:false/);});

test('audit counters never describe unverified provisional profits as verified',()=>{assert.match(source,/verified:0,costChecked:/);assert.match(source,/freightChecked:/);assert.match(source,/profitVerified:0/);assert.match(source,/launchEconomicsEligible:0/);});

test('preview profit audit requires caller-provided admin bearer and never fabricates authorization',()=>{assert.match(source,/req\.headers\?\.authorization/);assert.match(source,/crypto\.timingSafeEqual/);assert.match(source,/getShopifyAuthContext\(req\)/);assert.doesNotMatch(source,/getShopifyAuthContext\(\{headers:\{authorization:'Bearer '\+admin\}\}\)/);});

test('CJ freight must be positive and standard margin floor is 30 percent',()=>{assert.match(source,/filter\(x=>x!==null&&x>0\)/);assert.match(source,/const minimumContributionMarginPercent=30;/);assert.match(source,/minimumContributionMarginPercent:30/);});

test('zero CJ supplier price is rejected before any profit estimate',()=>{assert.match(source,/usd===null\|\|usd<=0/);assert.match(source,/reason:'cj-cost-unverified'/);});

test('read-only profit audit uses validated CJ-managed stock and requires five units',()=>{assert.match(source,/validateCJStockResponse\(sj\)/);assert.match(source,/stock\.total>=5/);assert.match(source,/cjStockVerified=false,cjStockAvailable=false/);assert.match(source,/stockChecked:/);assert.match(source,/stockAvailable:/);});

test('combined audit triage holds unverified stock, freight, and cost assumptions',()=>{assert.match(source,/const estimatedAuditStatus=!cjStockVerified\|\|!cjStockAvailable\|\|!cjFreightVerified\|\|!assumptionsReady/);assert.match(source,/:estimatedMarginTier===30\?'provisional-pass'/);assert.match(source,/:'exception-review'/);assert.match(source,/:'exclude'/);assert.match(source,/provisionalPass:rows\.filter/);assert.match(source,/launchEconomicsEligible:false/);});
