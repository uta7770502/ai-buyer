const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../lib/routes/preview-profit-audit.js'),'utf8');
test('draft audit does not assert independently verified profit',()=>{assert.match(source,/const contributionMarginVerified=false,finalProfitVerified=false;/);assert.match(source,/profitVerificationReason='cj_freight_and_actual_fees_not_verified'/);});
test('tier checks raw ratio, not rounded display margin',()=>{assert.match(source,/finalProfitJpy\/sale>=0\.30/);assert.match(source,/finalProfitJpy\/sale>=0\.25/);assert.match(source,/finalProfitJpy\/sale>=0\.20/);});

test('estimate tiers cannot authorize launch',()=>{assert.match(source,/const estimatedMarginTier=/);assert.match(source,/launchEconomicsEligible:false/);assert.match(source,/launchEconomicsEligible:0/);assert.match(source,/estimatedEconomicsEligible:/);assert.doesNotMatch(source,/recommendedMarginTier/);});

test('CJ freight quote is scoped to exact variant and Japan and remains informational',()=>{assert.match(source,/logistic\/freightCalculate/);assert.match(source,/endCountryCode:'JP'/);assert.match(source,/products:\[\{quantity:1,vid\}\]/);assert.match(source,/cjFreightVerified/);assert.match(source,/launchEconomicsEligible:false/);});
