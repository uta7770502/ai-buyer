import assert from 'node:assert/strict';
import test from 'node:test';
import {buildLegalNotice} from '../api/shopify-legal-preview.js';

const valid={
  sellerName:'Example',representative:'Representative',address:'Tokyo',
  phone:'000',email:'contact@example.com',paymentTiming:'At order',
  shippingWindow:'Within 7 days',returnDays:14,returnConditions:'Unused',
  returnShipping:'Buyer pays',additionalFees:'None',privacyContact:'contact@example.com'
};
test('legal notice escapes injected HTML',()=>{
  const html=buildLegalNotice({...valid,sellerName:'<script>alert(1)</script>'});
  assert.equal(html.includes('<script>'),false);
  assert.equal(html.includes('&lt;script&gt;'),true);
});
test('legal notice rejects missing fields and invalid return days',()=>{
  assert.throws(()=>buildLegalNotice({...valid,representative:''}));
  assert.throws(()=>buildLegalNotice({...valid,returnDays:0}));
});
