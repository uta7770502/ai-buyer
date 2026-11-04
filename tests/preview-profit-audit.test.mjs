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
 assert.match(block,/const expectedSkus=PREVIEW_MANAGED_CJ_VIDS;/);
 assert.match(block,/const missingSkus=expectedSkus\.filter/);
 assert.match(block,/catalogCoverageComplete:missingSkus\.length===0/);
 assert.match(block,/catalogCoverage:\{expected:expectedSkus\.length,missingSkus,unexpectedSkus,duplicateSkus\}/);
});


test('consolidated launch audit rejects unexpected CJ SKUs in freight stock or profit results',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 const start=source.indexOf('async function previewLaunchAuditSummary');
 const end=source.indexOf('function deploymentInfo',start);
 const block=source.slice(start,end);
 assert.match(block,/const unexpectedSkus=/);
 assert.match(block,/!expectedSkus\.includes\(vid\)/);
 assert.match(block,/unexpectedSkus\.length===0/);
 assert.match(block,/catalogCoverage:\{expected:expectedSkus\.length,missingSkus,unexpectedSkus,duplicateSkus\}/);
});


test('preview diagnostics use one canonical managed CJ SKU list across freight stock and consolidated audit',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 assert.match(source,/const PREVIEW_MANAGED_CJ_VIDS=\[/);
 assert.equal((source.match(/const vids=PREVIEW_MANAGED_CJ_VIDS;/g)||[]).length,2);
 assert.match(source,/const expectedSkus=PREVIEW_MANAGED_CJ_VIDS;/);
});


test('consolidated launch audit rejects duplicate SKU rows instead of treating set coverage as complete',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 const start=source.indexOf('async function previewLaunchAuditSummary');
 const end=source.indexOf('function deploymentInfo',start);
 const block=source.slice(start,end);
 assert.match(block,/const duplicateSkus=\{/);
 assert.match(block,/duplicateSkus\.freight===0/);
 assert.match(block,/duplicateSkus\.stock===0/);
 assert.match(block,/duplicateSkus\.profit===0/);
 assert.match(block,/catalogCoverage:\{expected:expectedSkus\.length,missingSkus,unexpectedSkus,duplicateSkus\}/);
});


test('manual preview audit workflow remains read-only and cannot perform launch actions',()=>{
 const wf=fs.readFileSync(new URL('../.github/workflows/cj-preview-smoke.yml',import.meta.url),'utf8');
 assert.match(wf,/workflow_dispatch:/);
 assert.doesNotMatch(wf,/push:/);
 assert.doesNotMatch(wf,/SHOPIFY_LIVE_PUBLISH_ENABLED/);
 assert.doesNotMatch(wf,/ODDLY_CHECKOUT_ENABLED/);
 assert.doesNotMatch(wf,/CJ_ALLOW_REAL_SHOPIFY_ORDERS_IN_SANDBOX/);
 assert.doesNotMatch(wf,/ADS_LIVE_ENABLED/);
 assert.doesNotMatch(wf,/removeStorefrontPassword|disablePasswordProtection/i);
 assert.doesNotMatch(wf,/api\/shopify-publish|api\/shopify-order-webhook|api\/cj-sandbox-simulate/);
 assert.match(wf,/api\/preview-launch-audit-summary/);
});


test('manual preview audit workflow has enough job time for preview verification plus consolidated audit',()=>{
 const wf=fs.readFileSync(new URL('../.github/workflows/cj-preview-smoke.yml',import.meta.url),'utf8');
 assert.match(wf,/timeout-minutes: 10/);
 assert.match(wf,/for i in \{1\.\.18\}/);
 assert.match(wf,/api\/preview-launch-audit-summary/);
});


test('consolidated launch audit returns a per-SKU freight stock profit matrix for all managed products',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 const start=source.indexOf('async function previewLaunchAuditSummary');
 const end=source.indexOf('function deploymentInfo',start);
 const block=source.slice(start,end);
 assert.match(block,/const skuMatrix=expectedSkus\.map/);
 assert.match(block,/freightPass/);
 assert.match(block,/stockPass/);
 assert.match(block,/profitPass/);
 assert.match(block,/launchCandidate:freightPass&&stockPass&&profitPass/);
 assert.match(block,/在庫21未満または未確認/);
 assert.match(block,/skuMatrix,/);
});


test('consolidated launch audit summarizes per-SKU blockers for fast diagnosis',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 const start=source.indexOf('async function previewLaunchAuditSummary');
 const end=source.indexOf('function deploymentInfo',start);
 const block=source.slice(start,end);
 assert.match(block,/const skuSummary=\{/);
 assert.match(block,/launchCandidates:skuMatrix\.filter\(x=>x\.launchCandidate\)\.length/);
 assert.match(block,/freightBlocked:skuMatrix\.filter\(x=>!x\.freightPass\)\.length/);
 assert.match(block,/stockBlocked:skuMatrix\.filter\(x=>!x\.stockPass\)\.length/);
 assert.match(block,/profitBlocked:skuMatrix\.filter\(x=>!x\.profitPass\)\.length/);
 assert.match(block,/skuSummary,/);
});


test('consolidated launch audit returns prioritized next actions for blocker resolution',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 const start=source.indexOf('async function previewLaunchAuditSummary');
 const end=source.indexOf('function deploymentInfo',start);
 const block=source.slice(start,end);
 assert.match(block,/const nextActions=\[\]/);
 assert.match(block,/監査対象SKUの不整合を解消/);
 assert.match(block,/送料未確認SKUを再取得/);
 assert.match(block,/在庫21未満SKUを販売候補から外し代替候補を補充/);
 assert.match(block,/最終利益条件未達SKUを価格調整または候補除外/);
 assert.match(block,/最終手動承認待ち/);
 assert.match(block,/nextActions,/);
});


test('consolidated launch audit never reports manual approval as the only next action when readiness is false',()=>{
 const source=fs.readFileSync(new URL('../api/diagnostics.js',import.meta.url),'utf8');
 const start=source.indexOf('async function previewLaunchAuditSummary');
 const end=source.indexOf('function deploymentInfo',start);
 const block=source.slice(start,end);
 assert.match(block,/const inconsistentState=!ready&&nextActions\.length===1&&nextActions\[0\]==='最終手動承認待ち'/);
 assert.match(block,/監査結果の不整合を再確認/);
 assert.match(block,/ready,inconsistentState/);
});


test('manual preview audit workflow persists the consolidated audit JSON as an artifact',()=>{
 const wf=fs.readFileSync(new URL('../.github/workflows/cj-preview-smoke.yml',import.meta.url),'utf8');
 assert.match(wf,/launch-audit\.json/);
 assert.match(wf,/actions\/upload-artifact@v4/);
 assert.match(wf,/name: oddly-launch-audit/);
 assert.match(wf,/retention-days: 14/);
});


test('saved launch audit artifact is traceable to commit branch run and timestamp',()=>{
 const wf=fs.readFileSync(new URL('../.github/workflows/cj-preview-smoke.yml',import.meta.url),'utf8');
 assert.match(wf,/auditArtifact/);
 assert.match(wf,/commitSha:process\.env\.GITHUB_SHA/);
 assert.match(wf,/branch:process\.env\.GITHUB_REF_NAME/);
 assert.match(wf,/runId:process\.env\.GITHUB_RUN_ID/);
 assert.match(wf,/recordedAt:new Date\(\)\.toISOString\(\)/);
});


test('manual preview audit writes a human-readable GitHub Actions summary',()=>{
 const wf=fs.readFileSync(new URL('../.github/workflows/cj-preview-smoke.yml',import.meta.url),'utf8');
 assert.match(wf,/Write launch audit summary/);
 assert.match(wf,/GITHUB_STEP_SUMMARY/);
 assert.match(wf,/公開候補/);
 assert.match(wf,/送料NG/);
 assert.match(wf,/在庫NG/);
 assert.match(wf,/利益NG/);
 assert.match(wf,/次のアクション/);
});


test('manual preview audit writes failure diagnosis even when the workflow stops early',()=>{
 const wf=fs.readFileSync(new URL('../.github/workflows/cj-preview-smoke.yml',import.meta.url),'utf8');
 assert.match(wf,/Write failure diagnosis/);
 assert.match(wf,/if: failure\(\)/);
 assert.match(wf,/監査失敗診断/);
 assert.match(wf,/統合監査JSON: 生成済み/);
});


test('manual preview audit failure diagnosis reports each guarded step outcome separately',()=>{
 const wf=fs.readFileSync(new URL('../.github/workflows/cj-preview-smoke.yml',import.meta.url),'utf8');
 assert.match(wf,/id: verify_preview/);
 assert.match(wf,/id: cj_connectivity/);
 assert.match(wf,/id: consolidated_audit/);
 assert.match(wf,/steps\.verify_preview\.outcome/);
 assert.match(wf,/steps\.cj_connectivity\.outcome/);
 assert.match(wf,/steps\.consolidated_audit\.outcome/);
 assert.match(wf,/Preview一致確認/);
 assert.match(wf,/CJ接続確認/);
 assert.match(wf,/統合監査:/);
});


test('manual preview audit verifies the read-only variant stock endpoint before consolidated audit',()=>{
 const wf=fs.readFileSync(new URL('../.github/workflows/cj-preview-smoke.yml',import.meta.url),'utf8');
 assert.match(wf,/Verify variant stock endpoint safety/);
 assert.match(wf,/id: variant_stock/);
 assert.match(wf,/catalogCoverage\?\.expectedSkus\?\.\[0\]|skuMatrix\?\.\[0\]\?\.sku/);
 assert.match(wf,/api\/cj-variant-stock\?vid=\$VID/);
 assert.match(wf,/"readOnly"/);
 assert.match(wf,/"minimumLaunchInventory"/);
 assert.match(wf,/steps\.variant_stock\.outcome/);
 assert.match(wf,/variant在庫API/);
});


test('manual preview audit persists the checked variant stock result into the launch artifact',()=>{
 const wf=fs.readFileSync(new URL('../.github/workflows/cj-preview-smoke.yml',import.meta.url),'utf8');
 assert.match(wf,/variantStockSmoke=/);
 assert.match(wf,/verifiedInventory:Number\(stock\.verifiedInventory\)/);
 assert.match(wf,/minimumLaunchInventory:Number\(stock\.minimumLaunchInventory\)/);
 assert.match(wf,/launchEligible:stock\.launchEligible===true/);
 assert.match(wf,/verifiedAt:String\(stock\.verifiedAt/);
 assert.match(wf,/variant在庫確認/);
});
