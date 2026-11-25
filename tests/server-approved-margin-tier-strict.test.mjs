import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('stored margin tier must be an exact numeric 20/25; no coercion', async()=>{
 const source=readFileSync(new URL('../lib/server-approved-margin.js',import.meta.url),'utf8');
 let lookups=0;
 const approvalLoader='export async function loadMarginException(){globalThis.__adpsTierLookups=(globalThis.__adpsTierLookups||0)+1;return {approved:true,threshold:20};}';
 const assessor='export function assessVerifiedProductMargin(e){return {approved:(e.threshold===25||(e.threshold===20&&!!e.marginException)),threshold:e.threshold,approval:e.marginException};}';
 const moduleSource=source
  .replace("'./server-margin-exception.js'",JSON.stringify('data:text/javascript,'+encodeURIComponent(approvalLoader)))
  .replace("'./verified-product-margin.js'",JSON.stringify('data:text/javascript,'+encodeURIComponent(assessor)));
 const {assessMarginWithStoredApproval}=await import('data:text/javascript,'+encodeURIComponent(moduleSource));
 globalThis.__adpsTierLookups=0;
 try{
  for(const tier of ['25','20','30',30,null,false,true,0,25.5,NaN,Infinity,{},[]]){
   const result=await assessMarginWithStoredApproval({expectedVid:'1234567890123',threshold:tier});
   assert.equal(result.approved,false,String(tier));
   assert.equal(result.approval,undefined,String(tier));
  }
  assert.equal(globalThis.__adpsTierLookups,0,'invalid tiers must not query stored approvals');
  const valid=await assessMarginWithStoredApproval({expectedVid:'1234567890123',threshold:20});
  assert.equal(valid.approved,true);
  assert.equal(globalThis.__adpsTierLookups,1);
  const defaultTier=await assessMarginWithStoredApproval({expectedVid:'1234567890123'});
  assert.equal(defaultTier.threshold,25);
  assert.equal(defaultTier.approval,undefined);
 }finally{delete globalThis.__adpsTierLookups;}
});
