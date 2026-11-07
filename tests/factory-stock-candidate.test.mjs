import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCJStockResponse} from '../lib/cj-stock-validation.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const endpoint=readFileSync(new URL('../lib/routes/cj-variant-stock.js',import.meta.url),'utf8');
const row=(cj,factory)=>({cjInventoryNum:cj,factoryInventoryNum:factory,totalInventoryNum:cj+factory});
const check=(cj,factory)=>validateCJStockResponse({result:true,data:[row(cj,factory)]});

test('warehouse stock and factory stock are separate; factory-only stock is not launch eligible',()=>{
 assert.deepEqual(check(0,8),{ok:true,total:0,factoryTotal:8,recommendationStockStatus:'factory-stock'});
 assert.deepEqual(check(5,0),{ok:true,total:5,factoryTotal:0,recommendationStockStatus:'cj-stock'});
 assert.deepEqual(check(0,0),{ok:true,total:0,factoryTotal:0,recommendationStockStatus:'out-of-stock'});
});

test('read-only variant endpoint returns factory inventory without using it for launch threshold',()=>{
 assert.match(endpoint,/factoryStockQuantity:checked\.factoryTotal/);
 assert.match(endpoint,/recommendationStockStatus:checked\.recommendationStockStatus/);
 assert.match(endpoint,/launchEligible:checked\.total>=MIN_LAUNCH_INVENTORY/);
});

test('candidate UI labels factory replenishment and retains factory-stock candidate',()=>{
 assert.match(html,/工場取り寄せ｜工場在庫/);
 assert.match(html,/if\(oddlyFactoryOrderState\(x\)\)\{/);
 assert.match(html,/factory_order_lead_time_unverified/);
 assert.match(html,/x\.factoryStockQuantity=stockData\.factoryStockQuantity/);
});

test('manual draft and retry are blocked while factory replenishment is unverified',()=>{
 assert.match(html,/if\(oddlyFactoryOrderState\(x\)\)return showCandidateToast\('工場取り寄せ：補充日数を確認するまでShopify登録は保留します'\)/);
 assert.match(html,/if\(oddlyFactoryOrderState\(x\)\)return showCandidateToast\('工場取り寄せ：補充日数の確認待ちです'\)/);
});
