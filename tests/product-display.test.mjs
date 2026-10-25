import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const context=vm.createContext({});
for(const [start,end] of [['japaneseProductName','shopifyPreparationBadge'],['normalizedCategory','addDetailCandidate']]){
 vm.runInContext(html.slice(html.indexOf('function '+start+'('),html.indexOf('function '+end+'(')),context);
}
test('Japanese display names do not infer unsupported sizes or solar features',()=>{
 assert.equal(context.japaneseProductName({name:'Cat carrier'}),'ペット用キャリーバッグ');
 assert.equal(context.japaneseProductName({name:'Electronic pet toy'}),'商品名の日本語確認待ち');
 assert.equal(context.japaneseProductName({name:'Creative Cute Cat Paws Glass Mug'}),'猫の肉球モチーフ カップ');
 assert.equal(context.japaneseProductName({name:'犬用給水ボトル'}),'犬用給水ボトル');
});
test('category is provisional and no longer labels all pets as carriers',()=>{
 assert.match(context.normalizedCategory({name:'Cat Paws Glass Mug'}),/生活雑貨.*仮分類/);
 assert.match(context.normalizedCategory({name:'Dog toy ball'}),/おもちゃ.*仮分類/);
 assert.equal(context.normalizedCategory({name:'Unknown product',category:'Pet Supplies'}),'分類未確認');
});
test('detail preserves escaped supplier text separately from Japanese display',()=>{
 assert.match(html,/仕入先の商品名・説明（原文を確認）/);
 assert.match(html,/esc\(p.name\|\|'商品名未取得'\)/);
 assert.match(html,/翻訳・仕様確認が完了するまで/);
});
vm.runInContext(html.slice(html.indexOf('function detailProductForDisplay('),html.indexOf('let detailRequestVersion=')),context);
const scoreContext=vm.createContext({fx:150});
vm.runInContext(html.slice(html.indexOf('const parsePrice='),html.indexOf('function learnedMetrics(')),scoreContext);
test('detail reuses only matching listing counts and preserves fresh prices',()=>{
 const p=context.detailProductForDisplay({id:'a',sellPrice:3},{id:'a',sellPrice:2,listedNum:530,verifiedInventory:99,complaintRisk:{level:'low'}});
 assert.equal(p.listedNum,530);assert.equal(p.sellPrice,3);assert.equal(p.verifiedInventory,undefined);assert.equal(p.complaintRisk,undefined);
 assert.equal(context.detailProductForDisplay({id:'b'},{id:'a',listedNum:530}).listedNum,undefined);
 assert.equal(context.detailProductForDisplay({id:'a',listedNum:0},{id:'a',listedNum:530}).listedNum,0);
});
test('unknown costs never receive cheap-cost or high-margin bonuses',()=>{
 const m=scoreContext.metrics({image:'test'});
 assert.ok(m.reasons.includes('仕入価格は未確認'));
 assert.ok(m.reasons.includes('掲載実績は未確認'));
 assert.ok(!m.reasons.includes('粗利率が高い'));
 assert.ok(!m.reasons.includes('仕入価格良好'));
 const catalog={id:'a',sellPrice:3,listedNum:530,image:'test'};
 assert.equal(scoreContext.metrics(catalog).score,scoreContext.metrics(context.detailProductForDisplay({id:'a',sellPrice:3,image:'test'},catalog)).score);
});
function detailHarness(){
 const pending=new Map();const detail={innerHTML:''};
 const c=vm.createContext({detail,modal:{classList:{add(){},remove(){}},querySelector(){return null}},results:[],today:{products:[]},lastCjProductSearchAt:0,waitMs:async()=>{},
 fetch:url=>new Promise((resolve,reject)=>pending.set(url.split('=')[1],{resolve,reject})),isCjRateLimitMessage:()=>false,
 metrics:()=>({score:50,reasons:[],sell:1000}),cleanProductDescription:()=>'',findActive:()=>null,esc:x=>String(x),yen:String,japaneseProductName:p=>p.name,normalizedCategory:()=>'',document:{getElementById:()=>null}});
 vm.runInContext(html.slice(html.indexOf('function detailProductForDisplay('),html.indexOf('function normalizedCategory(')),c);
 vm.runInContext(html.slice(html.indexOf('function closeModal(){'),html.indexOf('function showPage(')),c);
 return {c,pending,detail};
}
test('late old detail responses cannot overwrite the latest selection',async()=>{
 const {c,pending,detail}=detailHarness();const a=c.openDetail('a');const b=c.openDetail('b');await new Promise(setImmediate);
 pending.get('b').resolve({ok:true,json:async()=>({ok:true,product:{id:'b',name:'new item'}})});await b;
 const current=detail.innerHTML;assert.match(current,/new item/);
 pending.get('a').resolve({ok:true,json:async()=>({ok:true,product:{id:'a',name:'old item'}})});await a;
 assert.equal(detail.innerHTML,current);
});
test('closed details ignore pending errors and mismatched products show no switch',async()=>{
 let h=detailHarness();let loading=h.c.openDetail('a');h.c.closeModal();const before=h.detail.innerHTML;
 h.pending.get('a').reject(Error('private upstream error'));await loading;assert.equal(h.detail.innerHTML,before);
 h=detailHarness();loading=h.c.openDetail('a');h.pending.get('a').resolve({ok:true,json:async()=>({ok:true,product:{id:'b'}})});await loading;
 assert.match(h.detail.innerHTML,/商品詳細を取得できませんでした/);assert.doesNotMatch(h.detail.innerHTML,/role="switch"/);
});
