import test from 'node:test';
import assert from 'node:assert/strict';
import {saveShopifySession,loadShopifySession} from '../lib/shopify-session-store.js';
import {saveLegalConfig,loadLegalConfig} from '../lib/legal-config-store.js';

test('Preview reauthorization and legal edits cannot overwrite or read production records',async()=>{
  const keys=['VERCEL_ENV','VERCEL_GIT_COMMIT_REF','SHOPIFY_TOKEN_ENCRYPTION_KEY','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','KV_REST_API_URL','KV_REST_API_TOKEN'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]])),originalFetch=globalThis.fetch;
  const records=new Map();let requests=0;
  globalThis.fetch=async(url,opts)=>{
    requests++;
    assert.equal(url,process.env.VERCEL_ENV==='preview'?'https://preview.invalid/':'https://redis.invalid/');
    assert.equal(opts.headers.Authorization,process.env.VERCEL_ENV==='preview'?'Bearer preview-test':'Bearer test');
    const [cmd,key,value]=JSON.parse(opts.body);
    if(cmd==='SET'){records.set(key,value);return {ok:true,json:async()=>({result:'OK'})};}
    assert.equal(cmd,'GET');
    return {ok:true,json:async()=>({result:records.get(key)??null})};
  };
  try{
    Object.assign(process.env,{VERCEL_ENV:'production',SHOPIFY_TOKEN_ENCRYPTION_KEY:'11'.repeat(32),UPSTASH_REDIS_REST_URL:'https://redis.invalid',UPSTASH_REDIS_REST_TOKEN:'test'});
    await saveShopifySession('test.myshopify.com','production-token');
    await saveLegalConfig({seller:'production'});
    const productionRecords=new Map(records);
    Object.assign(process.env,{VERCEL_ENV:'preview',KV_REST_API_URL:'https://preview.invalid',KV_REST_API_TOKEN:'preview-test',VERCEL_GIT_COMMIT_REF:'safety-gate-20261024',SHOPIFY_TOKEN_ENCRYPTION_KEY:'22'.repeat(32)});
    assert.equal(await loadShopifySession('test.myshopify.com'),null);
    assert.equal(await loadLegalConfig(),null);
    await saveShopifySession('test.myshopify.com','preview-token');
    await saveLegalConfig({seller:'preview'});
    assert.equal(await loadShopifySession('test.myshopify.com'),'preview-token');
    assert.equal((await loadLegalConfig()).seller,'preview');
    process.env.VERCEL_GIT_COMMIT_REF='other-branch';
    assert.equal(await loadShopifySession('test.myshopify.com'),null);
    assert.equal(await loadLegalConfig(),null);
    delete process.env.VERCEL_GIT_COMMIT_REF;
    const before=requests;
    await assert.rejects(()=>saveShopifySession('test.myshopify.com','bad'),/Preview/);
    await assert.rejects(()=>saveLegalConfig({seller:'bad'}),/Preview/);
    await assert.rejects(()=>loadShopifySession('test.myshopify.com'),/Preview/);
    await assert.rejects(()=>loadLegalConfig(),/Preview/);
    assert.equal(requests,before);
    for(const [key,value] of productionRecords)assert.equal(records.get(key),value);
    Object.assign(process.env,{VERCEL_ENV:'production',SHOPIFY_TOKEN_ENCRYPTION_KEY:'11'.repeat(32)});
    assert.equal(await loadShopifySession('test.myshopify.com'),'production-token');
    assert.equal((await loadLegalConfig()).seller,'production');
  }finally{
    globalThis.fetch=originalFetch;
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
