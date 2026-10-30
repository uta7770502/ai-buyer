import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeStockAudit} from '../lib/stock-audit-summary.js';

test('empty audit cannot report verified inventory',()=>{
  assert.deepEqual(summarizeStockAudit([]),{
    variants:0,partial:false,noAuditableVariants:true,allVerified:false,
    inSync:0,needsSync:0,changed:0,blocked:0
  });
});

test('blocked audit is partial and never fully verified',()=>{
  const summary=summarizeStockAudit([
    {ok:true,cjStock:4,effectiveShopifyStock:4,changed:false},
    {ok:false,reason:'shopify-stock-unverified'}
  ]);
  assert.equal(summary.partial,true);
  assert.equal(summary.allVerified,false);
  assert.equal(summary.blocked,1);
  assert.equal(summary.inSync,1);
});

test('confirmed changes count as synchronized, not pending',()=>{
  const summary=summarizeStockAudit([
    {ok:true,cjStock:7,effectiveShopifyStock:7,changed:true},
    {ok:true,cjStock:5,effectiveShopifyStock:2,changed:false}
  ]);
  assert.equal(summary.allVerified,true);
  assert.equal(summary.changed,1);
  assert.equal(summary.inSync,1);
  assert.equal(summary.needsSync,1);
});
