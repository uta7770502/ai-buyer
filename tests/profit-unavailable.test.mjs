import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function hasVerifiedSales('),html.indexOf('function renderAll('));
const actions=html.slice(html.indexOf('function buildDailyActions('),html.indexOf('function renderDailyActions('));
function setup(summary){
 const nodes={}; const document={getElementById:id=>nodes[id]??=( {textContent:'',title:''})};
 const c=vm.createContext({salesSummary:summary,document,active:[],today:{products:[]},yen:v=>'¥'+v,
 estimateFinalProfit:()=>({productCost:0,shipping:0,adSpend:0,fees:0,refund:0,unmatchedUnits:0,complete:true}),
 growthGoalStatus:()=>({phase:'chase',gap:10000}),salesGoalPacing:()=>({monthBehind:true,yearBehind:true})});
 vm.runInContext(source+actions,c);return {c,nodes};
}
for(const [label,summary] of Object.entries({missing:{},error:{checkedAt:'today',error:'failed'},loading:{checkedAt:'today',loading:true},partial:{checkedAt:'today',truncated:true}})){
 test(label+' holds profit and daily pace advice',()=>{
 const {c,nodes}=setup(summary);c.renderProfitBreakdown();
 assert.equal(nodes.heroProfit.textContent,'未確認');assert.equal(nodes.sales.textContent,'未確認');
 assert.equal(nodes.profitDataBadge.textContent,'未確認');
 const a=c.buildDailyActions();assert.equal(a.length,1);assert.match(a[0].text,/判断を保留/);
 });
}
test('verified zero retains zero costs and expected pace advice',()=>{
 const {c,nodes}=setup({checkedAt:'today'});c.renderProfitBreakdown();
 assert.equal(nodes.profitCostToday.textContent,'¥0');assert.equal(nodes.profitDataBadge.textContent,'見込み');
 assert.equal(c.buildDailyActions().length,3);
});
