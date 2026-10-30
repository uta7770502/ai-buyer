import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function recommendationReviewReady('),end=html.indexOf('\nfunction ',html.indexOf('async function enrichRiskList(',start));
function setup(fetch=async()=>{throw Error('timeout')}){
 const c=vm.createContext({fetch,AbortSignal});vm.runInContext(html.slice(start,end),c);return c;
}
const good=()=>({id:'p1',complaintRisk:{level:'low',exclude:false,checkedAt:new Date().toISOString(),reviewCount:100,lowReviews:0,twoStarReviews:0,rating:4.5}});
test('recommendations require current complete review evidence',()=>{
 const {recommendationReviewReady:ready}=setup();assert.equal(ready(good()),true);
 for(const change of [{checkedAt:''},{checkedAt:new Date(Date.now()-86400001).toISOString()},{checkedAt:new Date(Date.now()+60000).toISOString()},{reviewCount:0},{reviewCount:'100'},{rating:3.9},{rating:6},{lowReviews:3},{twoStarReviews:5},{exclude:true},{level:'unknown'}]){
  const p=good();Object.assign(p.complaintRisk,change);assert.equal(ready(p),false,JSON.stringify(change));
 }
 assert.equal(ready({id:'p1'}),false);
});
test('review request limit never approves unchecked products',async()=>{
 const c=setup(async()=>({ok:true,json:async()=>({ok:true,risk:good().complaintRisk})}));
 const rows=[{id:'p1'},{id:'p2'}];await c.enrichRiskList(rows,1);
 assert.equal(c.recommendationReviewReady(rows[0]),true);assert.equal(c.recommendationReviewReady(rows[1]),false);
});
test('failed refresh invalidates stale positive evidence',async()=>{
 const c=setup();const p=good();p.complaintRisk.checkedAt='2020-01-01';await c.enrichRiskList([p]);assert.equal(p.complaintRisk.exclude,true);assert.equal(c.recommendationReviewReady(p),false);
});
test('saved recommendations and recently removed items cannot bypass review gate',()=>{
 const c=setup();c.today={products:[good(),{id:'unchecked'}]};c.recentlyRemovedCandidates=()=>[{product:{id:'removed'}}];c.findActive=()=>null;c.catalogRisk=()=>({exclude:false});
 vm.runInContext(html.slice(html.indexOf('function orderedRecommendedProducts('),html.indexOf('function toggleCandidate(')),c);
 assert.deepEqual(Array.from(c.orderedRecommendedProducts(),p=>p.id),['p1']);
});
