import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('async function inspectDiscoveryVariantStock(pool)');
const end=html.indexOf('function renderDiscoveryPreview(pool)',start);
const code=html.slice(start,end);
test('discovery rejects stale, future and non-read-only CJ variant stock responses',()=>{
 assert.ok(start>=0&&end>start);
 assert.match(code,/stock\.readOnly!==true/);
 assert.match(code,/stockCheckedAt>Date\.now\(\)/);
 assert.match(code,/Date\.now\(\)-stockCheckedAt>15\*60\*1000/);
 assert.match(code,/!Number\.isFinite\(stockCheckedAt\)/);
});
test('discovery does not trust a server launch flag without sufficient verified inventory',()=>{
 assert.match(code,/stock\.launchEligible===true&&stock\.verifiedInventory>=SAFE_DISCOVERY_MIN_VERIFIED_INVENTORY/);
});
