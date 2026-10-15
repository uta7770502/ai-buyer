import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { saveShopifySession,loadShopifySession } from '../lib/shopify-session-store.js';

test('encrypted offline token round-trip never stores plaintext',async()=>{
 const oldKey=process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY,oldUrl=process.env.UPSTASH_REDIS_REST_URL,oldToken=process.env.UPSTASH_REDIS_REST_TOKEN,oldFetch=globalThis.fetch;
 process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
 process.env.UPSTASH_REDIS_REST_URL='https://redis.example.test';
 process.env.UPSTASH_REDIS_REST_TOKEN='fake-test-token';
 const memory=new Map();
 globalThis.fetch=async(url,opts)=>{
   assert.equal(url,'https://redis.example.test/');
   const [cmd,key,value]=JSON.parse(opts.body);
   if(cmd==='SET'){memory.set(key,value);return {ok:true,json:async()=>({result:'OK'})};}
   if(cmd==='GET')return {ok:true,json:async()=>({result:memory.get(key)??null})};
   throw Error('Unexpected command');
 };
 try{
   await saveShopifySession('test.myshopify.com','shpat_sensitive_example');
   assert.equal(memory.size,1);
   const encrypted=[...memory.values()][0];
   assert.equal(encrypted.includes('shpat_sensitive_example'),false);
   assert.equal(await loadShopifySession('test.myshopify.com'),'shpat_sensitive_example');
   assert.equal(await loadShopifySession('other.myshopify.com'),null);
   const key=[...memory.keys()][0];const tampered=JSON.parse(encrypted);tampered.data=Buffer.from('corrupted').toString('base64');memory.set(key,JSON.stringify(tampered));
   await assert.rejects(()=>loadShopifySession('test.myshopify.com'));
 }finally{
   globalThis.fetch=oldFetch;
   for(const [key,val] of [['SHOPIFY_TOKEN_ENCRYPTION_KEY',oldKey],['UPSTASH_REDIS_REST_URL',oldUrl],['UPSTASH_REDIS_REST_TOKEN',oldToken]]){if(val===undefined)delete process.env[key];else process.env[key]=val;}
 }
});
test('missing encryption key fails closed',async()=>{
 const previous=process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;
 delete process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;
 try{await assert.rejects(()=>loadShopifySession('test.myshopify.com'),/encryption/)}
 finally{if(previous!==undefined)process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY=previous}
});
