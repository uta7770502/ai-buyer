import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('async function refreshSalesSummary('),html.indexOf('function growthDailyRevenue('));
function setup(reply){
  const context=vm.createContext({salesSummary:{daily:100},location:{href:'/'},renders:0,
    fetch:async()=>({ok:reply.ok,json:async()=>reply}),
    renderSalesGoals(){context.renders++},renderGrowthMode(){},renderAll(){},
    sessionStorage:{setItem(){}}});
  vm.runInContext(source,context);return context;
}
test('startup sales read is silent and expired authentication renders without navigation',async()=>{
  assert.match(html,/renderReturnAudit\(\);refreshSalesSummary\(\{silent:true\}\);/);
  const c=setup({authRequired:true});
  assert.equal(await c.refreshSalesSummary({silent:true}),false);
  assert.equal(c.location.href,'/');assert.equal(c.salesSummary.loading,false);
  assert.match(c.salesSummary.error,/認証が必要/);assert.equal(c.renders,2);
});
test('explicit sales update can still start authentication',async()=>{
  const c=setup({authRequired:true});await c.refreshSalesSummary();
  assert.equal(c.location.href,'/api/shopify-auth');
});
test('successful silent sales read retains real totals',async()=>{
  const c=setup({ok:true,daily:1200,monthly:3600,yearly:7200});
  assert.equal(await c.refreshSalesSummary({silent:true}),true);
  assert.equal(c.salesSummary.daily,1200);assert.equal(c.salesSummary.error,'');assert.equal(c.location.href,'/');
});
