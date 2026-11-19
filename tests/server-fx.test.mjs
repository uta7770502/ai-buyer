import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/server-fx.js',import.meta.url),'utf8');
const {getUsdJpyRate}=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));
const now=Date.parse('2026-10-24T00:00:00Z');
const make=(data,ok=true)=>async()=>({ok,json:async()=>data});
test('accepts current server-fetched USD JPY rate',async()=>{
 const r=await getUsdJpyRate({now,fetcher:make({result:'success',rates:{JPY:150},time_last_update_unix:Math.floor(now/1000)-3600})});
 assert.equal(r.verified,true);assert.equal(r.usdJpyRate,150);assert.equal(r.fxSource,'open.er-api.com');
});
test('rejects stale FX',async()=>{
 const r=await getUsdJpyRate({now,fetcher:make({result:'success',rates:{JPY:150},time_last_update_unix:Math.floor(now/1000)-200000})});
 assert.equal(r.verified,false);
});
test('rejects malformed and failed FX responses',async()=>{
 for(const data of [{result:'error',rates:{JPY:150}},{result:'success',rates:{JPY:'150'}},{result:'success',rates:{JPY:0}}]){
  assert.equal((await getUsdJpyRate({now,fetcher:make(data)})).verified,false);
 }
 assert.equal((await getUsdJpyRate({now,fetcher:async()=>{throw Error('offline')}})).verified,false);
});
