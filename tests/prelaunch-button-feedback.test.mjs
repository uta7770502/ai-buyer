import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('async function runOneActionPrelaunch(){'),html.indexOf('async function checkReleaseReadiness(){'));
function setup(getKey){
  const nodes=Object.fromEntries(['oneActionPrelaunchBtn','oneActionPrelaunchStatus','oneActionPrelaunchBlockers','oneActionPrelaunchBadge'].map(id=>[id,{textContent:'未実行',disabled:false}]));
  let requests=0;
  const context=vm.createContext({document:{getElementById:id=>nodes[id]},getTestAdminKey:getKey,active:[],fetch:async()=>{requests++;return {ok:false,json:async()=>({error:'Unauthorized'})}}});
  vm.runInContext(source,context);
  return {nodes,run:()=>context.runOneActionPrelaunch(),requests:()=>requests};
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
