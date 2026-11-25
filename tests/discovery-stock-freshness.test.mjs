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

 test('factory candidates require fresh exact-SKU stock evidence and sufficient combined inventory',()=>{
 const a=code.indexOf('const factoryCandidate=');const b=code.indexOf(';',a);
 assert.ok(a>=0&&b>a);
 const candidate=Function('SAFE_DISCOVERY_MIN_VERIFIED_INVENTORY',code.slice(a,b)+';return factoryCandidate;')(5);
 const base={recommendationStockEligible:true,requiresFactoryReplenishment:true,verifiedInventory:2,factoryStockQuantity:3};
 assert.equal(candidate(base),true);
 assert.equal(candidate({...base,verifiedInventory:0,factoryStockQuantity:5}),true);
 for(const patch of [{factoryStockQuantity:2},{factoryStockQuantity:0},{factoryStockQuantity:'3'},{recommendationStockEligible:false},{requiresFactoryReplenishment:false},{verifiedInventory:-1},{verifiedInventory:5}])assert.equal(candidate({...base,...patch}),false,JSON.stringify(patch));
 assert.match(code,/if\(!selectedVariant&&factoryVariant\)/);
 assert.match(code,/\|\|factoryCandidate\(stock\)\)\{/);
 assert.match(code,/p\.discoveryProfitChecked=false/);
 });
