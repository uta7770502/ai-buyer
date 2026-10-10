import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../storefront.html',import.meta.url),'utf8');
const source=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace('render();loadShopifyProducts();','');
function app({preview=false,saved={},fetcher=async()=>{throw Error('offline')}}={}){
 const nodes=new Map(),storage=new Map();storage.set('adps-shop-'+(preview?'preview':'live')+'-v1',JSON.stringify(saved));
 function node(){const classes=new Set();return {style:{},value:'',innerHTML:'',textContent:'',isConnected:true,classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x)},setAttribute(){},focus(){},remove(){},closest(){return null},querySelector(){return null}}}
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},activeElement:node(),body:{...node(),children:[]},head:{appendChild(){}},createElement:node,addEventListener(){},querySelector(){return null}};
 const ctx=vm.createContext({document,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,location:{search:preview?'?preview=1':'',href:'https://example.com/shop'},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},addEventListener(){},fetch:fetcher});
 vm.runInContext(source,ctx);return {run:code=>vm.runInContext(code,ctx),nodes,storage};
}
test('explicit preview works offline and filters category, budget and fullwidth queries',async()=>{
 const a=app({preview:true});await a.run('loadShopifyProducts()');
 assert.equal(a.run('products.length'),10);assert.equal(a.run("searchProducts('ゴルフ').length"),1);
 assert.equal(a.run("searchProducts('3,000円以下').every(p=>p.price<=3000)"),true);
 assert.equal(a.run("searchProducts('ＬＥＤ').length"),1);
 a.run("toggleFavorite('golf');searchMode='favorites'");assert.equal(a.run("searchProducts('').length"),1);
});
test('live fetch failure never substitutes samples or destroys saved cart',async()=>{
 const a=app({saved:{cart:[{id:'saved',qty:2}]}});await a.run('loadShopifyProducts()');
 assert.equal(a.run('products.length'),0);assert.equal(a.run('cart[0].id'),'saved');
 assert.match(a.nodes.get('shopStatus').innerHTML,/再読み込み/);
});
test('empty authoritative catalog is preparation state, not sample products',async()=>{
 const a=app({fetcher:async()=>({ok:true,json:async()=>({ok:true,authoritative:true,products:[]})})});await a.run('loadShopifyProducts()');
 assert.equal(a.run('products.length'),0);assert.match(a.nodes.get('shopStatus').textContent,/準備中/);
});
test('cart rejects unknown and unavailable items, caps quantity and stores no prices',()=>{
 const a=app();a.run("products=[{id:'yes',available:true,price:123,name:'test',img:''},{id:'no',available:false}];usingAuthoritativeProducts=true;addCart('missing');addCart('no')");assert.equal(a.run('cart.length'),0);
 a.run("for(let n=0;n<30;n++)addCart('yes')");assert.equal(a.run('cart[0].qty'),20);assert.equal(a.nodes.get('cartTotal').textContent,'¥2,460');
 const stored=JSON.parse(a.storage.get('adps-shop-live-v1'));assert.deepEqual(stored.cart,[{id:'yes',qty:20}]);
 assert.equal(a.nodes.get('checkoutButton').disabled,true);
});
test('product strings cannot introduce HTML attributes or unsafe image URLs',()=>{
 const a=app();const markup=a.run(`card({id:'x" onclick="alert(1)',name:'<img onerror=alert(1)>',img:'javascript:alert(1)',price:1})`);
 assert.ok(!markup.includes('<img onerror'));assert.ok(!markup.includes(' onclick="'));assert.ok(!markup.includes('javascript:'));assert.match(markup,/&lt;img/);
});
test('schema does not fabricate delivery promises or free returns',()=>{
 const a=app({preview:true});assert.equal(a.run('productStructuredData(products[0]).offers'),undefined);
 const data=a.run("productStructuredData({...products[0],authoritative:true,available:true,shipping:{price:100,country:'JP'},returnPolicy:{days:14,country:'JP'}})");
 assert.equal(data.offers.shippingDetails.deliveryTime,undefined);assert.equal(data.offers.hasMerchantReturnPolicy.returnFees,undefined);
 assert.equal(a.run('normalizeShopifyProduct({shipping:{price:-1}}).shipping'),null);
});
test('price sorting preserves catalog order and favorites remain scoped when clearing search',()=>{
 const a=app({preview:true});const first=a.run('products[0].id');
 a.nodes.set('searchSort',{value:'price-desc'});
 assert.equal(a.run("searchProducts('')[0].price"),6980);
 assert.equal(a.run('products[0].id'),first);
 a.run("toggleFavorite('golf');searchMode='favorites';selectSearch('')");
 assert.equal(a.run("searchProducts('').length"),1);
 assert.equal(a.run("searchProducts('')[0].id"),'golf');
});
test('overlapping catalog requests cannot replace newer results with a late failure',async()=>{
 const pending=[];const a=app({fetcher:(_url,options)=>new Promise((resolve,reject)=>pending.push({resolve,reject,signal:options.signal}))});
 const first=a.run('loadShopifyProducts()');const second=a.run('loadShopifyProducts()');
 assert.equal(pending[0].signal.aborted,true);
 pending[1].resolve({ok:true,json:async()=>({ok:true,authoritative:true,products:[{id:'new',title:'New',featuredImage:{url:'https://example.com/image.jpg'},variant:{price:{amount:200,currencyCode:'JPY'},availableForSale:true},authoritative:true}]})});
 await second;pending[0].reject(Error('late failure'));await first;
 assert.equal(a.run('products[0].id'),'new');assert.equal(a.run('catalogLoading'),false);
 assert.match(a.nodes.get('searchResults').innerHTML,/New/);
});
test('catalog refresh blocks additions using an old price',async()=>{
 let resolve;const a=app({fetcher:()=>new Promise(r=>resolve=r)});
 a.run("products=[{id:'old',available:true,price:1}]");const pending=a.run('loadShopifyProducts()');
 a.run("addCart('old')");assert.equal(a.run('cart.length'),0);
 resolve({ok:true,json:async()=>({ok:true,authoritative:true,products:[]})});await pending;
});
test('dialog background preserves preexisting inert state and inactive closes do not unlock it',()=>{
 const a=app();a.run(`globalThis.background={tagName:'MAIN',inert:false,matches:()=>false};globalThis.hiddenSection={tagName:'SECTION',inert:true,matches:()=>false};document.body.children=[background,hiddenSection];openLayer('searchLayer')`);
 assert.equal(a.run('background.inert'),true);
 a.run("closeLayer('productModal')");assert.equal(a.run('background.inert'),true);
 a.run("closeLayer('searchLayer')");assert.equal(a.run('background.inert'),false);assert.equal(a.run('hiddenSection.inert'),true);
});
