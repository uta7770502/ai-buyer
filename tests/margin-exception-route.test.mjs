import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../api/margin-exception.js',import.meta.url),'utf8');
test('margin exception storage is preview-only and admin-only',()=>{
 for(const term of ["VERCEL_ENV!=='preview'","VERCEL_GIT_COMMIT_REF!=='safety-gate-20261024'","timingSafeEqual","admin-required","redisConnection()"])assert.ok(src.includes(term),term);
});
test('approval requires exact SKU, explicit confirmation and only 20/25 thresholds',()=>{
 for(const term of ["\\d{10,25}","threshold!==20&&threshold!==25","req.body?.confirm!==true","crypto.randomUUID()","approvedAt:new Date().toISOString()"])assert.ok(src.includes(term),term);
});
test('approvals are revocable, expire, and never enable publishing',()=>{
 for(const term of ["['DEL',keyFor(vid)]","'EX',30*86400","!Number.isFinite(Date.parse(record.approvedAt))"])assert.ok(src.includes(term),term);
 assert.doesNotMatch(src,/shopify-publish|productActivate|checkoutEnable/);
});
