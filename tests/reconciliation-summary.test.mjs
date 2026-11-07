import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/automation-reconciliation.js';

async function invoke(scan){
  const values={AI_BUYER_ADMIN_KEY:'test',UPSTASH_REDIS_REST_URL:'https://redis.invalid',UPSTASH_REDIS_REST_TOKEN:'test'};
  const previous=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
  const original=globalThis.fetch,commands=[];
  Object.assign(process.env,values);
  globalThis.fetch=async(url,options)=>{
    const command=JSON.parse(options.body);commands.push(command);
    const result=command[0]==='SCAN'?scan(command):command.slice(1).map(()=> 'reserved');
    return {ok:true,json:async()=>({result})};
  };
  let status,body;
  try{
    await handler({method:'GET',headers:{authorization:'Bearer test'},query:{kind:'summary'}},{setHeader(){},status(value){status=value;return this;},json(value){body=value;}});
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
