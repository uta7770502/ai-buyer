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
 assert.match(source,/ad_cost_per_order_jpy/);
 assert.match(source,/return_reserve_per_order_jpy/);
 assert.match(source,/assumptionsReady/);
 assert.match(source,/finalProfitJpy/);
 assert.doesNotMatch(source,/mutation\s/i);
});


test('server stock audit enforces the same 21-unit launch floor as the UI gate',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 assert.match(source,/minimumLaunchInventory:21/);
 assert.match(source,/totalInventory>20/);
 assert.match(source,/launchEligible/);
});


test('preview launch audit summary consolidates stock profit and prelaunch readiness without mutation',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 const vercel=fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8');
 assert.match(source,/async function previewLaunchAuditSummary/);
 assert.match(source,/stockVerified/);
 assert.match(source,/launchInventoryReady/);
 assert.match(source,/profitVerified/);
 assert.match(source,/finalProfitReady/);
 assert.match(source,/prelaunchAuditReady/);
 assert.match(source,/readOnly:true/);
 assert.match(vercel,/preview-launch-audit-summary/);
});
