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
