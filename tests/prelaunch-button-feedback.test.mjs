import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('async function runOneActionPrelaunch(){'),html.indexOf('async function checkReleaseReadiness(){'));
function setup(getKey,stockEvidence=null){
  const nodes=Object.fromEntries(['oneActionPrelaunchBtn','oneActionPrelaunchStatus','oneActionPrelaunchBlockers','oneActionPrelaunchBadge'].map(id=>[id,{textContent:'未実行',disabled:false}]));
  let requests=0,lastBody=null;
  const context=vm.createContext({document:{getElementById:id=>nodes[id]},getTestAdminKey:getKey,active:[],currentStockEvidence:stockEvidence,fetch:async(url,options)=>{requests++;lastBody=JSON.parse(options.body);return {ok:false,json:async()=>({error:'Unauthorized'})}}});
  vm.runInContext(source,context);
  return {nodes,run:()=>context.runOneActionPrelaunch(),requests:()=>requests,lastBody:()=>lastBody};
}
test('missing key gives visible explanation without sending readiness request',async()=>{
  const s=setup(()=> '');await s.run();
  assert.match(s.nodes.oneActionPrelaunchStatus.textContent,/未実行：.*管理者キー/);
  assert.equal(s.nodes.oneActionPrelaunchBadge.textContent,'入力待ち');
  assert.equal(s.nodes.oneActionPrelaunchBtn.disabled,false);assert.equal(s.requests(),0);
});
test('key retrieval failure is visible and button can be retried',async()=>{
  const s=setup(()=>{throw new Error('Storage unavailable')});await s.run();
  assert.match(s.nodes.oneActionPrelaunchStatus.textContent,/安全停止: Storage unavailable/);
  assert.equal(s.nodes.oneActionPrelaunchBadge.textContent,'停止');
  assert.equal(s.nodes.oneActionPrelaunchBtn.disabled,false);assert.equal(s.requests(),0);
});
test('invalid key shows failed authentication rather than completion',async()=>{
  const s=setup(()=> 'diagnostic-invalid');await s.run();
  assert.match(s.nodes.oneActionPrelaunchStatus.textContent,/安全停止: Unauthorized/);
  assert.equal(s.nodes.oneActionPrelaunchBtn.disabled,false);assert.equal(s.requests(),1);
});

test('prelaunch sends existing signed evidence but still reports unauthorized',async()=>{
 const s=setup(()=> 'diagnostic-invalid','server-issued-fixture');await s.run();
 assert.equal(s.lastBody().stockEvidence,'server-issued-fixture');
 assert.match(s.nodes.oneActionPrelaunchStatus.textContent,/安全停止: Unauthorized/);
});
