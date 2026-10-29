import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function hasFreshGrowthSales('),html.indexOf('function maybeDailyGrowth('));
const verified=html.slice(html.indexOf('function hasVerifiedSales('),html.indexOf('function renderProfitBreakdown('));
function setup(summary,connected=false,recovered=null){
 const nodes={growthSummary:{textContent:'old'},growthActions:{innerHTML:'old expansion advice'}};
 const events=[];
 const c=vm.createContext({salesSummary:summary,shopifyConnected:connected,growthSettings:{mode:'test'},
 document:{getElementById:id=>nodes[id]},alert:()=>events.push('alert'),
 refreshSalesSummary:async()=>{events.push('refresh');if(recovered)c.salesSummary=recovered},
 growthGoalStatus:()=>{events.push('decision');throw Error('verified decision reached')}});
 vm.runInContext(verified+source,c);return {c,events,nodes};
}
for(const [label,summary] of Object.entries({missing:{},error:{checkedAt:new Date().toISOString(),error:'failed'},partial:{checkedAt:new Date().toISOString(),truncated:true},loading:{checkedAt:new Date().toISOString(),loading:true},stale:{checkedAt:new Date(Date.now()-600000).toISOString()},future:{checkedAt:new Date(Date.now()+600000).toISOString()}})){
 test(label+' blocks growth side effects and clears previous advice',async()=>{
  const {c,events,nodes}=setup(summary);await c.runGrowthEngine(true);
  assert.deepEqual(events,[]);assert.match(nodes.growthSummary.textContent,/保留/);assert.equal(nodes.growthActions.innerHTML,'');
 });
}
test('failed silent refresh holds decisions without repeated authentication',async()=>{
 const {c,events}=setup({},true);await c.runGrowthEngine(false);assert.deepEqual(events,['refresh','alert']);
});
test('successful refresh permits decision path including verified zero sales',async()=>{
 const {c,events}=setup({},true,{checkedAt:new Date().toISOString(),daily:0});
 await assert.rejects(c.runGrowthEngine(true),/verified decision reached/);assert.deepEqual(events,['refresh','decision']);
});
