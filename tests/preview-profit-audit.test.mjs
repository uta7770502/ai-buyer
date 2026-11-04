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
 assert.match(source,/catalogCoverageComplete/);
 assert.match(source,/profitVerified/);
 assert.match(source,/supplierLaunchCandidateReady/);
 assert.match(source,/prelaunchAuditReady/);
 assert.match(source,/readOnly:true/);
 assert.match(vercel,/preview-launch-audit-summary/);
});


test('consolidated launch audit runs CJ-backed checks sequentially to avoid supplier rate-limit collisions',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 const start=source.indexOf('async function previewLaunchAuditSummary');
 const end=source.indexOf('function deploymentInfo',start);
 const block=source.slice(start,end);
 assert.doesNotMatch(block,/Promise\.all\(\[/);
 assert.match(block,/await previewCjStockAudit/);
 assert.match(block,/await previewProfitAudit/);
 assert.match(block,/setTimeout\(r,1500\)/);
});


test('consolidated launch audit includes fresh CJ freight verification before stock and profit checks',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 const start=source.indexOf('async function previewLaunchAuditSummary');
 const end=source.indexOf('function deploymentInfo',start);
 const block=source.slice(start,end);
 assert.match(block,/await previewCjDraftAudit/);
 assert.match(block,/freightVerified/);
 assert.match(block,/freight:\{total:/);
 const a=block.indexOf('await previewCjDraftAudit');
 const b=block.indexOf('await previewCjStockAudit');
 const c=block.indexOf('await previewProfitAudit');
 assert.ok(a>=0&&b>a&&c>b);
});


test('consolidated launch audit requires the same CJ SKU to pass freight stock and final-profit gates',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 const start=source.indexOf('async function previewLaunchAuditSummary');
 const end=source.indexOf('function deploymentInfo',start);
 const block=source.slice(start,end);
 assert.match(block,/const freightOk=new Set/);
 assert.match(block,/const stockOk=new Set/);
 assert.match(block,/const profitOk=new Set/);
 assert.match(block,/freightOk\.has\(vid\)&&profitOk\.has\(vid\)/);
 assert.match(block,/supplierLaunchCandidateReady:launchCandidateSkus\.length>0/);
 assert.match(block,/supplierLaunchCandidates:\{count:launchCandidateSkus\.length/);
});


test('consolidated launch audit fails closed when any of the nine managed CJ SKUs is missing from an audit',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 const start=source.indexOf('async function previewLaunchAuditSummary');
 const end=source.indexOf('function deploymentInfo',start);
 const block=source.slice(start,end);
 assert.match(block,/const expectedSkus=\[/);
 assert.match(block,/const missingSkus=expectedSkus\.filter/);
 assert.match(block,/catalogCoverageComplete:missingSkus\.length===0/);
 assert.match(block,/catalogCoverage:\{expected:expectedSkus\.length,missingSkus,unexpectedSkus\}/);
});


test('consolidated launch audit rejects unexpected CJ SKUs in freight stock or profit results',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 const start=source.indexOf('async function previewLaunchAuditSummary');
 const end=source.indexOf('function deploymentInfo',start);
 const block=source.slice(start,end);
 assert.match(block,/const unexpectedSkus=/);
 assert.match(block,/!expectedSkus\.includes\(vid\)/);
 assert.match(block,/unexpectedSkus\.length===0/);
 assert.match(block,/catalogCoverage:\{expected:expectedSkus\.length,missingSkus,unexpectedSkus\}/);
});
