import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function goalBarRow('),html.indexOf('async function refreshSalesSummary('));
function render(summary){
 const nodes=Object.fromEntries(['salesGoalRows','salesGoalStamp','salesGoalAiNote'].map(id=>[id,{innerHTML:'',textContent:''}]));
 const c=vm.createContext({salesSummary:summary,salesGoalSettings:{daily:10000,monthly:310000,yearly:3650000},document:{getElementById:id=>nodes[id]},yen:v=>'¥'+v,growthGoalStatus:()=>({phase:'chase',gap:10000}),salesGoalPacing:()=>({})});
 vm.runInContext(source+';renderSalesGoals()',c);
 return nodes;
}
for(const [label,summary] of Object.entries({
 unrequested:{daily:0}, expired:{daily:1000,checkedAt:'2026-10-28T00:00:00Z',error:'Shopify認証が必要です'},
 refreshing:{daily:1000,checkedAt:'2026-10-28T00:00:00Z',loading:true},
 failed:{daily:0,error:'取得失敗'}
})){
 test(label+' does not claim zero progress or forecast',()=>{
  const n=render(summary);
  assert.equal((n.salesGoalRows.innerHTML.match(/未確認/g)||[]).length,3);
  assert.doesNotMatch(n.salesGoalRows.innerHTML,/%|残り|着地予測|現在/);
  assert.match(n.salesGoalRows.innerHTML,/310000/);
  assert.match(n.salesGoalAiNote.textContent,/判定を保留/);
  if(summary.error)assert.match(n.salesGoalStamp.textContent,/取得エラー/);
 });
}
test('verified zero sales is correctly shown as zero progress',()=>{
 const n=render({daily:0,monthly:0,yearly:0,checkedAt:'2026-10-29T00:00:00Z'});
 assert.match(n.salesGoalRows.innerHTML,/0%/);
 assert.doesNotMatch(n.salesGoalRows.innerHTML,/未確認/);
});
test('verified sales restore actual progress',()=>{
 const n=render({daily:5000,monthly:155000,yearly:1825000,checkedAt:'2026-10-29T00:00:00Z'});
 assert.equal((n.salesGoalRows.innerHTML.match(/50%/g)||[]).length,6);
 assert.match(n.salesGoalRows.innerHTML,/現在 ¥5000/);
});
