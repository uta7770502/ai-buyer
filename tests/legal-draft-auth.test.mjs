import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/legal-draft.js';
function response(){
 return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},json(body){this.body=body;return this}};
}
test('legal draft API rejects anonymous reads and writes',async()=>{
 const prior=process.env.AI_BUYER_ADMIN_KEY;
 process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 try{
  for(const method of ['GET','POST','DELETE']){
   const res=response();
   await handler({method,headers:{},body:{sellerName:'private'}},res);
   assert.equal(res.statusCode,401);
   assert.equal(res.body.ok,false);
  }
 }finally{
  if(prior===undefined)delete process.env.AI_BUYER_ADMIN_KEY;
  else process.env.AI_BUYER_ADMIN_KEY=prior;
 }
});
test('legal draft API rejects unsupported methods before storage access',async()=>{
 const res=response();
 await handler({method:'PUT',headers:{}},res);
 assert.equal(res.statusCode,405);
});
test('legal draft API rejects invalid field types without writing',async()=>{
 const prior=process.env.AI_BUYER_ADMIN_KEY;
 process.env.AI_BUYER_ADMIN_KEY='test-only-secret';
 try{
  const res=response();
  await handler({method:'POST',headers:{authorization:'Bearer test-only-secret'},body:{sellerName:{unexpected:'object'}}},res);
  assert.equal(res.statusCode,400);
 }finally{
  if(prior===undefined)delete process.env.AI_BUYER_ADMIN_KEY;
  else process.env.AI_BUYER_ADMIN_KEY=prior;
 }
});
