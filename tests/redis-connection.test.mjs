import test from 'node:test';
import assert from 'node:assert/strict';
import {redisConnection} from '../lib/redis-connection.js';
import {redis} from '../lib/sandbox-order.js';
const legacy={UPSTASH_REDIS_REST_URL:'https://production.invalid',UPSTASH_REDIS_REST_TOKEN:'production-test'};
const kv={KV_REST_API_URL:'https://preview.invalid/',KV_REST_API_TOKEN:'preview-test'};
test('production retains its existing Redis even with Marketplace variables present',()=>{
 assert.deepEqual(redisConnection({...legacy,...kv,VERCEL_ENV:'production'}),{url:legacy.UPSTASH_REDIS_REST_URL,token:legacy.UPSTASH_REDIS_REST_TOKEN});
});
test('Preview selects the complete Marketplace pair',()=>{
 assert.deepEqual(redisConnection({...legacy,...kv,VERCEL_ENV:'preview'}),{url:'https://preview.invalid',token:'preview-test'});
});
for(const partial of [{},{KV_REST_API_URL:kv.KV_REST_API_URL},{KV_REST_API_TOKEN:kv.KV_REST_API_TOKEN},{...kv,KV_REST_API_URL:'http://preview.invalid'},{...kv,KV_REST_API_TOKEN:' '}])test('Preview never falls back to Production for missing or invalid credentials '+JSON.stringify(Object.keys(partial)),()=>{
 assert.deepEqual(redisConnection({...legacy,...partial,VERCEL_ENV:'preview'}),{url:'',token:''});
});
test('Preview order storage stops without network IO when Marketplace credentials are missing',async()=>{
 const values={...legacy,VERCEL_ENV:'preview',KV_REST_API_URL:'',KV_REST_API_TOKEN:''};
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 const original=globalThis.fetch;let calls=0;
 Object.assign(process.env,values);globalThis.fetch=async()=>{calls++;throw Error('unexpected IO')};
 try{await assert.rejects(()=>redis(['GET','test']),/not configured/);assert.equal(calls,0);}
 finally{globalThis.fetch=original;for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
