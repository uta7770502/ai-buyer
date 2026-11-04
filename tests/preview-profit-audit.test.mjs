import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('preview profit audit stays read-only and fails closed on unverified supplier cost',()=>{
 const source=fs.readFileSync(new URL('../lib/routes/preview-profit-audit.js',import.meta.url),'utf8');
 assert.match(source,/readOnly:true/);
 assert.match(source,/cj-cost-unverified/);
 assert.match(source,/variantSellPrice/);
 assert.match(source,/grossMarginPercent/);
 assert.match(source,/paymentFeeJpy/);
 assert.match(source,/contributionBeforeAdsJpy/);
 assert.match(source,/launchEconomicsEligible/);
 assert.match(source,/minimumContributionMarginPercent=35/);
 assert.match(source,/contributionMarginPercent>=minimumContributionMarginPercent/);
 assert.doesNotMatch(source,/mutation\s/i);
});


test('server stock audit enforces the same 21-unit launch floor as the UI gate',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 assert.match(source,/minimumLaunchInventory:21/);
 assert.match(source,/totalInventory>20/);
 assert.match(source,/launchEligible/);
});
