import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY='11'.repeat(32);
const {createShopifyBrowserSession,verifyShopifyBrowserSession}=await import('../lib/shopify-auth-context.js');

test('signed Shopify browser session round-trips and rejects tampering',()=>{
  const value=createShopifyBrowserSession('test-store.myshopify.com',300);
  assert.equal(verifyShopifyBrowserSession(value),'test-store.myshopify.com');
  const tampered=value.slice(0,-1)+(value.endsWith('a')?'b':'a');
  assert.equal(verifyShopifyBrowserSession(tampered),null);
});
test('signed Shopify browser session rejects expired values',()=>{
  const value=createShopifyBrowserSession('test-store.myshopify.com',-1);
  assert.equal(verifyShopifyBrowserSession(value),null);
});
test('OAuth callback never persists raw Shopify access token in browser cookie',()=>{
  const source=fs.readFileSync(new URL('../api/shopify-callback.js',import.meta.url),'utf8');
  assert.ok(source.includes("'shopify_access_token=; Path=/;"));
  assert.ok(!source.includes("'shopify_access_token='+encodeURIComponent(j.access_token)"));
  assert.ok(source.includes("'shopify_session='+encodeURIComponent(browserSession)"));
});
