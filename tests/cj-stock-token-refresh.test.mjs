import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-variant-stock.js';

test('stock verification refreshes CJ token from API key even when a stale static token exists',async t=>{
  const oldKey=process.env.CJ_API_KEY,oldToken=process.env.CJ_ACCESS_TOKEN;
  process.env.CJ_API_KEY='test-api-key';
  process.env.CJ_ACCESS_TOKEN='expired-static-token';
  t.after(()=>{
    if(oldKey===undefined)delete process.env.CJ_API_KEY;else process.env.CJ_API_KEY=oldKey;
    if(oldToken===undefined)delete process.env.CJ_ACCESS_TOKEN;else process.env.CJ_ACCESS_TOKEN=oldToken;
  });
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url:String(url),options});
    if(String(url).includes('/authentication/getAccessToken'))
      return {ok:true,json:async()=>({result:true,data:{accessToken:'fresh-stock-token',accessTokenExpiryDate:'2099-01-01T00:00:00Z'}})};
    return {ok:true,status:200,json:async()=>({result:false,data:null})};
  });
  const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'GET',query:{vid:'1234567890123'}},res);
  assert.equal(calls.length,2);
  assert.match(calls[0].url,/authentication\/getAccessToken/);
  assert.equal(calls[1].options.headers['CJ-Access-Token'],'fresh-stock-token');
  assert.notEqual(res.body.ok,true);
});
