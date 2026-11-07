import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('ADPS reference UI keeps all five destinations and distinct pages',()=>{
 for(const id of ['home','recommend','operations','profit','settings'])assert.match(html,new RegExp('<section id="'+id+'" class="page(?: on)?"'));
 assert.match(html,/showPage\('operations',this\)/);
 assert.match(html,/showPage\('settings',this\)/);
});
test('home summary derives values from existing operational display rather than fictional numbers',()=>{
 for(const id of ['adpsSummaryDaily','adpsSummaryProfit','adpsSummaryCandidates','adpsSummaryStatus'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(html,/function syncAdpsHomeSummary\(/);
 assert.match(html,/MutationObserver\(syncAdpsHomeSummary\)/);
});
test('visual refresh retains automation gates and existing data sources',()=>{
 for(const id of ['heroProfit','sales','activeCount','profitDataBadge','autoCountPrepare','orderFlowWebhook'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(html,/priceEstimateOnly===true/);
 assert.match(html,/本番公開・商品ACTIVE・実CJ発注・広告配信は承認まで停止/);
});
