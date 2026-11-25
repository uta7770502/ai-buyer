import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{verifyStockReadback,verifyStockWritePlan,executeStockWritePlan} from '../lib/routes/cj-shopify-stock-sync.js';
import {verifyStockEvidence} from '../lib/stock-audit-evidence.js';

async function run(t,{failure=false,throws=false,transient=false,mutation='ok',dry=false,duplicateSku=false,duplicateItem=false,empty=false,tracking='enabled'}={}){
  const env={AI_BUYER_ADMIN_KEY:'test-key',CJ_SHOPIFY_STOCK_SYNC_ENABLED:'true',CJ_ACCESS_TOKEN:'test-cj',SHOPIFY_ALLOWED_SHOP_DOMAIN:'test.myshopify.com',SHOPIFY_ADMIN_ACCESS_TOKEN:'test-shopify',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'safety-gate-20261024',SHOPIFY_TOKEN_ENCRYPTION_KEY:'ab'.repeat(32)};
  for(const [k,v] of Object.entries(env)){const old=process.env[k];process.env[k]=v;t.after(()=>old===undefined?delete process.env[k]:process.env[k]=old);}
  t.mock.method(globalThis,'setTimeout',fn=>{fn();return 0;});
  const events=[];let input;
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    const reply=data=>({ok:true,status:200,json:async()=>data});
    if(String(url).includes('queryByVid')){
      events.push('cj');
      if(throws&&String(url).includes('1421057421656330242'))throw Error('timeout');
      if(events.filter(x=>x==='cj').length===2){
        if(transient)throw Error('timeout');
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
    // ADPS's inventory scope can read location IDs without read_locations.
    assert.doesNotMatch(body.query,/location\s*\{[^}]*\bname\b/);
    return reply({data:{products:{pageInfo:{hasNextPage:false},nodes:[{id:'p1',title:'test',status:'DRAFT',vendor:'ODDLY',variants:{pageInfo:{hasNextPage:false},nodes:(empty?[]:[1,2]).map(n=>({id:'v'+n,sku:'142105742165633024'+(duplicateSku?1:n),inventoryPolicy:'DENY',inventoryItem:{...(n===2&&tracking==='missing'?{}:{tracked:n===2&&tracking==='disabled'?false:true}),id:'gid://shopify/InventoryItem/'+(duplicateItem?1:n),inventoryLevels:{pageInfo:{hasNextPage:false},nodes:[{location:{id:'gid://shopify/Location/1'},quantities:[{name:'available',quantity:0}]}]}}}))}}]}}});
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

test('supplier network failure preserves verified rows but blocks CAS and signed evidence',async t=>{
 const {res,events}=await run(t,{dry:true,throws:true});
 assert.equal(res.code,200);
 assert.equal(res.body.ok,false);
 assert.equal(res.body.partial,true);
 assert.equal(res.body.rows.length,2);
 assert.equal(res.body.rows[0].ok,true);
 assert.equal(res.body.rows[1].reason,'cj-network-error');
 assert.equal(res.body.stockEvidence,null);
 assert.equal(res.body.syncPlan.ready,false);
 assert.deepEqual(res.body.syncPlan.quantities,[]);
 assert.ok(!events.includes('write'));
});

test('stock audit needs only the location ID, not the restricted location name',async t=>{
 const {res,events}=await run(t,{dry:true});
 assert.equal(res.body.ok,true);
 assert.equal(res.body.rows[0].location,'gid://shopify/Location/1');
 assert.equal(res.body.syncPlan.ready,true);
 assert.ok(!events.includes('write'));
});

test('transient CJ network error retries only the failed SKU and restores full evidence',async t=>{
 const {res,events}=await run(t,{dry:true,transient:true});
 assert.equal(res.body.ok,true);
 assert.equal(res.body.allVerified,true);
 assert.equal(events.filter(x=>x==='cj').length,3);
 assert.equal(res.body.syncPlan.ready,true);
 assert.ok(verifyStockEvidence(res.body.stockEvidence,res.body.rows.map(row=>row.vid)));
 assert.ok(!events.includes('write'));
});

test('inventory readback accepts only exact location and quantity for every unique target',()=>{
 const target={inventoryItemId:'gid://shopify/InventoryItem/1',locationId:'gid://shopify/Location/1',quantity:5};
 const node={id:target.inventoryItemId,inventoryLevels:{pageInfo:{hasNextPage:false},nodes:[{location:{id:target.locationId},quantities:[{name:'available',quantity:5}]}]}};
 assert.equal(verifyStockReadback([target],[node]),true);
 for(const bad of [[],[null],[{...node,id:'wrong'}],[{...node,inventoryLevels:{...node.inventoryLevels,pageInfo:{hasNextPage:true}}}],[{...node,inventoryLevels:{...node.inventoryLevels,nodes:[{location:{id:target.locationId},quantities:[{name:'available',quantity:4}]}]}}]])assert.equal(verifyStockReadback([target],bad),false);
 assert.equal(verifyStockReadback([target,target],[node,node]),false);
});

test('stock CAS plan rejects duplicate targets, invalid quantities and unchanged rows',()=>{
 const x={inventoryItemId:'gid://shopify/InventoryItem/1',locationId:'gid://shopify/Location/1',quantity:5,changeFromQuantity:0};
 assert.equal(verifyStockWritePlan([x]),true);
 for(const rows of [[],[x,x],[{...x,quantity:-1}],[{...x,quantity:2147483648}],[{...x,quantity:0}],[{...x,changeFromQuantity:null}],[{...x,locationId:'wrong'}],[null]])assert.equal(verifyStockWritePlan(rows),false);
});

for(const scenario of ['ok','reject','timeout','missing','mismatch','readback-timeout','invalid'])test('mock inventory execution: '+scenario,async()=>{
 const x={inventoryItemId:'gid://shopify/InventoryItem/1',locationId:'gid://shopify/Location/1',quantity:5,changeFromQuantity:0};
 const calls=[];
 const result=await executeStockWritePlan(scenario==='invalid'?[]:[x],async(query,variables)=>{
  if(query==='mutation'){
   calls.push('write');assert.deepEqual(variables.input.quantities,[x]);assert.ok(variables.idempotencyKey);
   if(scenario==='timeout')throw Error('timeout');
   return {inventorySetQuantities:scenario==='missing'?{}:scenario==='reject'?{userErrors:[{message:'rejected'}]}:{userErrors:[],inventoryAdjustmentGroup:{createdAt:'2026-11-25'}}};
  }
  calls.push('read');assert.deepEqual(variables.ids,[x.inventoryItemId]);
  if(scenario==='readback-timeout')throw Error('timeout');
  return {nodes:[{id:x.inventoryItemId,inventoryLevels:{pageInfo:{hasNextPage:false},nodes:[{location:{id:x.locationId},quantities:[{name:'available',quantity:scenario==='mismatch'?4:5}]}]}}]};
 },'mutation');
 assert.equal(result.error===null,scenario==='ok');
 assert.equal(result.unknown,['timeout','missing','mismatch','readback-timeout'].includes(scenario));
 assert.deepEqual(calls,scenario==='invalid'?[]:['ok','mismatch','readback-timeout'].includes(scenario)?['write','read']:['write']);
});
