import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-shopify-stock-sync.js';
import {verifyStockEvidence} from '../lib/stock-audit-evidence.js';

async function run(t,{failure=false,throws=false,mutation='ok',dry=false,duplicateSku=false,duplicateItem=false,empty=false,tracking='enabled'}={}){
  const env={AI_BUYER_ADMIN_KEY:'test-key',CJ_SHOPIFY_STOCK_SYNC_ENABLED:'true',CJ_ACCESS_TOKEN:'test-cj',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',SHOPIFY_ADMIN_ACCESS_TOKEN:'test-shopify',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'safety-gate-20261024',SHOPIFY_TOKEN_ENCRYPTION_KEY:'ab'.repeat(32)};
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
    if(body.query.includes('currentAppInstallation'))return reply({data:{currentAppInstallation:{accessScopes:[{handle:'read_inventory'},{handle:'write_inventory'}]}}});
    if(body.query.includes('mutation')){
      events.push('write');input=body.variables.input;
      if(mutation==='timeout')throw Error('timeout');
      return reply({data:{inventorySetQuantities:mutation==='missing'?{}:mutation==='reject'?{userErrors:[{message:'compare failed'}]}:{userErrors:[],inventoryAdjustmentGroup:{createdAt:'2026-10-25'}}}});
    }
    events.push('read');
    return reply({data:{products:{pageInfo:{hasNextPage:false},nodes:[{id:'p1',title:'test',status:'DRAFT',vendor:'ODDLY',variants:{pageInfo:{hasNextPage:false},nodes:(empty?[]:[1,2]).map(n=>({id:'v'+n,sku:'142105742165633024'+(duplicateSku?1:n),inventoryPolicy:'DENY',inventoryItem:{...(n===2&&tracking==='missing'?{}:{tracked:n===2&&tracking==='disabled'?false:true}),id:'gid://shopify/InventoryItem/'+(duplicateItem?1:n),inventoryLevels:{pageInfo:{hasNextPage:false},nodes:[{location:{id:'gid://shopify/Location/1',name:'test'},quantities:[{name:'available',quantity:0}]}]}}}))}}]}}});
  });
  const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  await handler({method:dry?'GET':'POST',query:{apply:'true'},headers:{authorization:'Bearer test-key'}},res);
  return {res,events,input};
}
test('apply is fail-closed before Shopify or CJ requests, including supplier failure scenarios',async t=>{
 for(const scenario of [{failure:true},{throws:true},{}]){
  const {res,events}=await run(t,scenario);
  assert.equal(res.code,409);
  assert.equal(res.body.ok,false);
  assert.equal(res.body.readOnly,true);
  assert.equal(res.body.mutationPerformed,false);
  assert.equal(res.body.code,'LOCATION_AVAILABLE_QUANTITY_UNVERIFIED');
  assert.deepEqual(events,['read']);
 }
});
for(const mutation of ['timeout','missing','reject'])test('apply never reaches '+mutation+' mutation while inventory write lock is active',async t=>{
 const {res,events}=await run(t,{mutation});
 assert.equal(res.code,409);
 assert.equal(res.body.code,'LOCATION_AVAILABLE_QUANTITY_UNVERIFIED');
 assert.equal(res.body.mutationPerformed,false);
 assert.deepEqual(events,['read']);
});
test('dry-run verifies all rows without writes',async t=>{const {res,events}=await run(t,{dry:true});assert.equal(res.body.ok,true);assert.equal(res.body.needsSync,2);assert.ok(!events.includes('write'));});
test('partial dry-run is not successful',async t=>{const {res}=await run(t,{dry:true,failure:true});assert.equal(res.body.ok,false);assert.equal(res.body.partial,true);});

for(const dry of [true,false])for(const kind of ['duplicateSku','duplicateItem','empty'])test(`${dry?'dry-run':'apply'} rejects ${kind} before supplier requests`,async t=>{
 const {res,events}=await run(t,{dry,[kind]:true});
 assert.equal(res.code,409);assert.equal(res.body.ok,false);assert.equal(res.body.readOnly,true);
 assert.equal(res.body.code,'DUPLICATE_OR_EMPTY_STOCK_IDENTIFIERS');
 assert.deepEqual(events,['read']);
});

for(const dry of [true,false])for(const tracking of ['disabled','missing'])test(`${dry?'dry-run':'apply'} rejects ${tracking} tracking before supplier requests or writes`,async t=>{
 const {res,events}=await run(t,{dry,tracking});
 assert.equal(res.code,409);assert.equal(res.body.ok,false);assert.equal(res.body.readOnly,true);
 assert.equal(res.body.code,'INVENTORY_TRACKING_REQUIRED');assert.equal(res.body.blockedVariants,1);
 assert.deepEqual(events,['read']);
});

test('complete dry-run issues reusable signed SKU evidence without an inventory write',async t=>{
 const {res,events}=await run(t,{dry:true});
 assert.equal(res.body.readOnly,true);
 assert.equal(res.body.allVerified,true);
 assert.ok(verifyStockEvidence(res.body.stockEvidence,res.body.rows.map(row=>row.vid)));
 assert.equal(verifyStockEvidence(res.body.stockEvidence,[res.body.rows[0].vid]),false);
 assert.ok(!events.includes('write'));
});
test('incomplete dry-run cannot issue stock evidence',async t=>{
 const {res}=await run(t,{dry:true,failure:true});
 assert.equal(res.body.stockEvidence,null);
});

test('read-only CAS preview uses exact location quantities, never factory stock or writes',async t=>{
 const {res,events}=await run(t,{dry:true});
 assert.equal(res.body.syncPlan.ready,true);
 assert.equal(res.body.syncPlan.mutationPerformed,false);
 assert.equal(res.body.syncPlan.writeLocked,true);
 assert.equal(res.body.syncPlan.factoryStockIncluded,false);
 assert.equal(res.body.syncPlan.changeCount,2);
 assert.deepEqual(res.body.syncPlan.quantities,[1,2].map(n=>({inventoryItemId:'gid://shopify/InventoryItem/'+n,locationId:'gid://shopify/Location/1',quantity:5,changeFromQuantity:0})));
 assert.ok(!events.includes('write'));
});
test('partial supplier audit yields no executable CAS preview',async t=>{
 const {res}=await run(t,{dry:true,failure:true});
 assert.equal(res.body.syncPlan.ready,false);
 assert.deepEqual(res.body.syncPlan.quantities,[]);
 assert.equal(res.body.syncPlan.mutationPerformed,false);
});
