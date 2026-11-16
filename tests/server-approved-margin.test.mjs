import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const loader=readFileSync(new URL('../lib/server-margin-exception.js',import.meta.url),'utf8');
const wrapper=readFileSync(new URL('../lib/server-approved-margin.js',import.meta.url),'utf8');
test('margin approvals come from trusted Redis and fail closed',()=>{
 for(const text of ["redisConnection()","VERCEL_ENV!=='preview'","VERCEL_GIT_COMMIT_REF!=='safety-gate-20261024'","'adps:margin-exception:v1:'","record.source!=='product-specific-owner-approval'","record.vid!==id","now-approvedAt>30*86400000","catch{return null;}"])assert.ok(loader.includes(text),text);
});
test('verified margin assessment replaces untrusted client approval with server record',()=>{
 assert.match(wrapper,/loadMarginException\(expectedVid,\{now\}\)/);
 assert.match(wrapper,/assessVerifiedProductMargin\(\{\.\.\.evidence,threshold,marginException:/);
 assert.ok(wrapper.includes('approvedThreshold?marginException:undefined'));
});

test('Redis-backed approval loader accepts matching record and rejects tampering or expiration',async t=>{
 const oldEnv={VERCEL_ENV:process.env.VERCEL_ENV,VERCEL_GIT_COMMIT_REF:process.env.VERCEL_GIT_COMMIT_REF};
 t.after(()=>{for(const [k,v] of Object.entries(oldEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 process.env.VERCEL_ENV='preview';process.env.VERCEL_GIT_COMMIT_REF='safety-gate-20261024';
 const mocked=loader.replace("'./redis-connection.js'",JSON.stringify('data:text/javascript,'+encodeURIComponent('export const redisConnection=()=>({url:"https://redis.example.test",token:"test"})')));
 const {loadMarginException}=await import('data:text/javascript,'+encodeURIComponent(mocked));
 const now=Date.parse('2026-11-09T00:00:00Z');
 const vid='1234567890123';
 const base={approved:true,source:'product-specific-owner-approval',vid,threshold:25,approvedAt:new Date(now-1000).toISOString(),approvalId:'approval-test-123'};
 const fetcher=record=>async(url,opts)=>({ok:true,json:async()=>({result:JSON.stringify(record)})});
 assert.equal((await loadMarginException(vid,{now,fetcher:fetcher(base)}))?.threshold,25);
 for(const record of [{...base,vid:'9999999999999'},{...base,approvedAt:new Date(now-31*86400000).toISOString()},{...base,approvalId:'bad'},{...base,threshold:30}])assert.equal(await loadMarginException(vid,{now,fetcher:fetcher(record)}),null);
 assert.equal(await loadMarginException('invalid',{now,fetcher:fetcher(base)}),null);
 assert.equal(await loadMarginException(vid,{now,fetcher:async()=>{throw Error('offline')}}),null);
});

test('stored approval wrapper never trusts caller-supplied approval and fails closed on mismatched tier',async t=>{
 const oldEnv={VERCEL_ENV:process.env.VERCEL_ENV,VERCEL_GIT_COMMIT_REF:process.env.VERCEL_GIT_COMMIT_REF};
 t.after(()=>{for(const [k,v] of Object.entries(oldEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 process.env.VERCEL_ENV='preview';process.env.VERCEL_GIT_COMMIT_REF='safety-gate-20261024';
 const marginModule='export const assessVerifiedProductMargin=(e)=>({approved:!!e.marginException,threshold:e.threshold,record:e.marginException||null});';
 const loaderModule='export const loadMarginException=async(id)=>({approved:true,source:"product-specific-owner-approval",vid:id,threshold:25,approvedAt:"2026-11-16T00:00:00Z",approvalId:"approval-test-123"});';
 const mocked=wrapper
  .replace("'./server-margin-exception.js'",JSON.stringify('data:text/javascript,'+encodeURIComponent(loaderModule)))
  .replace("'./verified-product-margin.js'",JSON.stringify('data:text/javascript,'+encodeURIComponent(marginModule)));
 const {assessMarginWithStoredApproval}=await import('data:text/javascript,'+encodeURIComponent(mocked));
 const attacker={expectedVid:'1234567890123',threshold:20,marginException:{approved:true,threshold:20,source:'product-specific-owner-approval'}};
 const rejected=await assessMarginWithStoredApproval(attacker);
 assert.equal(rejected.approved,false);
 assert.equal(rejected.record,null);
 const accepted=await assessMarginWithStoredApproval({...attacker,threshold:25});
 assert.equal(accepted.approved,true);
 assert.equal(accepted.record.threshold,25);
 const defaultTier=await assessMarginWithStoredApproval({...attacker,threshold:30});
 assert.equal(defaultTier.record,null);
});
