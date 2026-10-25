import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-detail.js';
async function run(t,data){
 const previous=process.env.CJ_ACCESS_TOKEN;process.env.CJ_ACCESS_TOKEN='test';
 t.after(()=>{if(previous===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=previous;});
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({result:true,data})}));
 const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{id:'product-1'}},res);return res;
}
test('detail rejects missing or mismatched supplier identities',async t=>{
 for(const data of [null,{},[],{pid:'product-2'}]){const res=await run(t,data);assert.equal(res.code,502);assert.notEqual(res.body.ok,true);}
});
test('detail keeps absent listing counts unknown and actual zero intact',async t=>{
 let res=await run(t,{pid:'product-1',sellPrice:3});assert.equal(res.code,200);assert.equal(res.body.product.listedNum,null);
 res=await run(t,{pid:'product-1',listedNum:0});assert.equal(res.body.product.listedNum,0);
});
