import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/storefront-config.js';
const response=()=>({code:200,setHeader(){},status(n){this.code=n;return this},json(v){this.body=v;return this}});
for(const method of ['GET','POST'])test(`legal ${method} refuses unreadable saved data without writing`,async t=>{
 const prev={...process.env};
 Object.assign(process.env,{VERCEL_ENV:'production',UPSTASH_REDIS_REST_URL:'https://redis.example',UPSTASH_REDIS_REST_TOKEN:'test',AI_BUYER_ADMIN_KEY:'test'});
 t.after(()=>{for(const k of Object.keys(process.env))if(!(k in prev))delete process.env[k];Object.assign(process.env,prev)});
 const commands=[];
 t.mock.method(globalThis,'fetch',async (url,opts)=>{commands.push(JSON.parse(opts.body));return {ok:false}});
 const res=response();await handler({method,headers:{authorization:'Bearer test'},body:{}},res);
 assert.equal(res.code,503);assert.equal(res.body.code,'LEGAL_CONFIG_READ_FAILED');assert.equal(res.body.legalReady,false);
 assert.equal(res.body.commerce,undefined);assert.equal(commands.length,1);assert.equal(commands[0][0],'GET');
});
test('unauthorized legal save performs no storage read',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('must not access storage')});
 const res=response();await handler({method:'POST',headers:{}},res);assert.equal(res.code,401);
});
