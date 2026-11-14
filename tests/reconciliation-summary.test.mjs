import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/automation-reconciliation.js';

async function invoke(scan,state='reserved',kind='summary'){
  const values={AI_BUYER_ADMIN_KEY:'test',UPSTASH_REDIS_REST_URL:'https://redis.invalid',UPSTASH_REDIS_REST_TOKEN:'test'};
  const previous=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
  const original=globalThis.fetch,commands=[];
  Object.assign(process.env,values);
  globalThis.fetch=async(url,options)=>{
    const command=JSON.parse(options.body);commands.push(command);
    const result=command[0]==='SCAN'?scan(command):command.slice(1).map(()=> state);
    return {ok:true,json:async()=>({result})};
  };
  let status,body;
  try{
    await handler({method:'GET',headers:{authorization:'Bearer test'},query:{kind}},{setHeader(){},status(value){status=value;return this;},json(value){body=value;}});
    return {status,body,commands};
  }finally{
    globalThis.fetch=original;
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
}

test('summary counts a repeated SCAN key once across pages',async()=>{
  const key='ai-buyer:cj-sandbox:one';
  const result=await invoke(cmd=>cmd[3]==='ai-buyer:cj-sandbox:*'?(cmd[1]==='0'?['12',[key]]:['0',[key,'ai-buyer:cj-sandbox:two']]):['0',[]]);
  assert.equal(result.status,200);
  assert.equal(result.body.summary.total,2);
  assert.equal(result.body.summary.review,2);
  assert.equal(result.body.summary.partial,false);
  assert.equal(result.commands.filter(c=>c[0]==='MGET').flatMap(c=>c.slice(1)).filter(k=>k===key).length,1);
});

for(const [name,page] of [
  ['foreign key',['0',['ai-buyer:shopify:offline:private']]],
  ['non-string key',['0',[null]]],
  ['invalid cursor',['invalid',[]]],
  ['oversized cursor',['1'.repeat(31),[]]],
  ['oversized page',['0',Array(1001).fill('ai-buyer:cj-sandbox:one')]]
])test('summary rejects '+name+' before reading any record',async()=>{
  const result=await invoke(()=>page);
  assert.equal(result.status,503);
  assert.equal(result.body.ok,false);
  assert.match(result.body.error,/公開を保留/);
  assert.ok(!result.commands.some(c=>c[0]==='MGET'));
});

test('unfinished SCAN is explicitly partial after the bounded page limit',async()=>{
  const result=await invoke(()=>['1',[]]);
  assert.equal(result.status,200);
  assert.equal(result.body.summary.partial,true);
  assert.equal(result.commands.length,30);
});

for(const kind of ['cj','fulfillment','simulation']){
  const prefix=kind==='cj'?'ai-buyer:cj-sandbox:':kind==='fulfillment'?'ai-buyer:fulfillment-sync:':'ai-buyer:sandbox-simulation:';
  for(const state of [null,42,{},'', 'unexpected', 'created:', 'synced:', 'needs_review:private-detail']){
    test(`${kind} unconfirmed state ${JSON.stringify(state)} stays visible in summary and queue`,async()=>{
      const scan=cmd=>cmd[3]===prefix+'*'?['0',[prefix+'one']]:['0',[]];
      const summary=await invoke(scan,state);
      assert.equal(summary.status,200);
      assert.equal(summary.body.summary.review,1);
      assert.equal(summary.body.summary.total,1);
      const queue=await invoke(scan,state,kind);
      assert.equal(queue.body.orders.length,1);
      assert.equal(queue.body.orders[0].reason,'result_ambiguous');
      assert.equal(queue.body.automaticRetry,false);
      assert.ok(queue.commands.every(c=>['SCAN','MGET'].includes(c[0])));
      assert.ok(!JSON.stringify(queue.body).includes('private-detail'));
    });
  }
  test(`${kind} confirmed state is excluded from review`,async()=>{
    const state=kind==='cj'?'created:ORDER_123':kind==='fulfillment'?'synced:gid://shopify/Fulfillment/123':'done';
    const scan=cmd=>cmd[3]===prefix+'*'?['0',[prefix+'one']]:['0',[]];
    assert.equal((await invoke(scan,state)).body.summary.total,0);
    assert.equal((await invoke(scan,state,kind)).body.orders.length,0);
  });
}
