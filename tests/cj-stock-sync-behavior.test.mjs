import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-shopify-stock-sync.js';

async function run(t,{failure=false,throws=false,mutation='ok',dry=false,duplicateSku=false,duplicateItem=false,empty=false}={}){
  const env={AI_BUYER_ADMIN_KEY:'test-key',CJ_SHOPIFY_STOCK_SYNC_ENABLED:'true',CJ_ACCESS_TOKEN:'test-cj',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',SHOPIFY_ADMIN_ACCESS_TOKEN:'test-shopify'};
  for(const [k,v] of Object.entries(env)){const old=process.env[k];process.env[k]=v;t.after(()=>old===undefined?delete process.env[k]:process.env[k]=old);}
  t.mock.method(globalThis,'setTimeout',fn=>{fn();return 0;});
  const events=[];let input;
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    const reply=data=>({ok:true,status:200,json:async()=>data});
    if(String(url).includes('queryByVid')){
      events.push('cj');
      if(events.filter(x=>x==='cj').length===2){
        if(throws)throw Error('timeout');
        if(failure)return reply({result:false});
      }
      return reply({result:true,data:[{cjInventoryNum:5,factoryInventoryNum:0,totalInventoryNum:5}]});
    }
    const body=JSON.parse(opts.body);
    if(body.query.includes('mutation')){
      events.push('write');input=body.variables.input;
      if(mutation==='timeout')throw Error('timeout');
      return reply({data:{inventorySetQuantities:mutation==='missing'?{}:mutation==='reject'?{userErrors:[{message:'compare failed'}]}:{userErrors:[],inventoryAdjustmentGroup:{createdAt:'2026-10-25'}}}});
    }
    events.push('read');
    return reply({data:{products:{pageInfo:{hasNextPage:false},nodes:[{id:'p1',title:'test',status:'DRAFT',vendor:'ODDLY',variants:{pageInfo:{hasNextPage:false},nodes:(empty?[]:[1,2]).map(n=>({id:'v'+n,sku:'142105742165633024'+(duplicateSku?1:n),inventoryPolicy:'DENY',inventoryItem:{id:'gid://shopify/InventoryItem/'+(duplicateItem?1:n),inventoryLevels:{pageInfo:{hasNextPage:false},nodes:[{location:{id:'gid://shopify/Location/1',name:'test'},quantities:[{name:'available',quantity:0}]}]}}}))}}]}}});
  });
  const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  await handler({method:dry?'GET':'POST',query:{apply:'true'},headers:{authorization:'Bearer test-key'}},res);
  return {res,events,input};
}
test('late CJ failure prevents every Shopify write',async t=>{
 const {res,events}=await run(t,{failure:true});assert.equal(res.code,409);assert.equal(res.body.changed,0);assert.equal(res.body.readOnly,true);assert.ok(!events.includes('write'));
});
test('late CJ timeout prevents every Shopify write',async t=>{
 const {res,events}=await run(t,{throws:true});assert.equal(res.code,503);assert.ok(!events.includes('write'));
});
test('all supplier checks precede a single CAS batch',async t=>{
 const {res,events,input}=await run(t);assert.deepEqual(events,['read','cj','cj','write']);assert.equal(input.quantities.length,2);assert.ok(input.quantities.every(q=>q.changeFromQuantity===0&&q.quantity===5));assert.equal(res.body.changed,2);assert.equal(res.body.inSync,2);
});
for(const mutation of ['timeout','missing','reject'])test('mutation '+mutation+' is not success or retried',async t=>{
 const {res,events}=await run(t,{mutation});assert.equal(res.code,503);assert.equal(res.body.ok,false);assert.equal(res.body.changed,0);assert.equal(res.body.retrySafe,false);assert.equal(events.filter(x=>x==='write').length,1);
});
test('dry-run verifies all rows without writes',async t=>{const {res,events}=await run(t,{dry:true});assert.equal(res.body.ok,true);assert.equal(res.body.needsSync,2);assert.ok(!events.includes('write'));});
test('partial dry-run is not successful',async t=>{const {res}=await run(t,{dry:true,failure:true});assert.equal(res.body.ok,false);assert.equal(res.body.partial,true);});

for(const dry of [true,false])for(const kind of ['duplicateSku','duplicateItem','empty'])test(`${dry?'dry-run':'apply'} rejects ${kind} before supplier requests`,async t=>{
 const {res,events}=await run(t,{dry,[kind]:true});
 assert.equal(res.code,409);assert.equal(res.body.ok,false);assert.equal(res.body.readOnly,true);
 assert.equal(res.body.code,'DUPLICATE_OR_EMPTY_STOCK_IDENTIFIERS');
 assert.deepEqual(events,['read']);
});
