import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../lib/routes/prelaunch-product-audit.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('const VERSION'),source.indexOf('export default')),context);

function product(days){
 return {status:'DRAFT',vendor:'ODDLY',title:'日本語商品',description:'日本語の商品説明',tags:[],
 variants:{nodes:[{sku:'1234567890123456',price:'2500',inventoryPolicy:'DENY',inventoryItem:{tracked:true}}]},
 media:{nodes:[{image:{url:'https://example.com/product.jpg'}}]},
 metafields:{nodes:[
  {key:'adps_audience',value:'飼い主'},{key:'adps_summary',value:'商品要約'},
  {key:'adps_why',value:'選定理由'},{key:'shipping_price_jpy',value:'500'},
  {key:'shipping_country',value:'JP'},{key:'return_days',value:String(days)}
 ]}};
}

test('return window accepts only 1 through 365 days',()=>{
 for(const days of [1,7,30,365]){
  assert.equal(context.assess(product(days)).reasons.some(x=>x.includes('返品受付日数')),false,String(days));
 }
 for(const days of [0,-1,366,99999,'1.5','abc','']){
  assert.equal(context.assess(product(days)).reasons.includes('返品受付日数未設定または不正'),true,String(days));
 }
});
