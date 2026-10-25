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
