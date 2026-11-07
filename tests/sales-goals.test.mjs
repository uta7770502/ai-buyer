import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function syncSalesGoalsFromDailyTarget()'),html.indexOf('function hydrateSalesGoals()'));
test('monthly goals use the agreed 31 days and annual goals use 365 days',()=>{
 const context=vm.createContext({growthSettings:{dailySalesFloor:10000},salesGoalSettings:{monthly:300000},localStorage:{setItem(){}}});
 vm.runInContext(source+';syncSalesGoalsFromDailyTarget()',context);
 assert.equal(context.salesGoalSettings.monthly,310000);assert.equal(context.salesGoalSettings.yearly,3650000);
 context.growthSettings.dailySalesFloor=20000;vm.runInContext('syncSalesGoalsFromDailyTarget()',context);
 assert.equal(context.salesGoalSettings.monthly,620000);assert.equal(context.salesGoalSettings.yearly,7300000);
});
