# ODDLY — Private prelaunch gate

**Do not remove Shopify storefront password protection or activate sales until every gate below is independently verified.** Vercel production deployment of the AI BUYER admin application is **not** equivalent to publishing the ODDLY Shopify storefront.

## Access and storefront
- [ ] Confirm Shopify storefront password protection is enabled from an unauthenticated browser.
- [ ] Verify no storefront public announcement, password removal, or automatic publication occurs during testing.
- [ ] Verify ODDLY branding, navigation, mobile rendering, policies and Japanese copy on a password-protected preview.
- [ ] Verify shop domain and payment provider settings without charging real customers.

## Shopify OAuth / secure server access
- [ ] Provision a unique 32-byte random hex SHOPIFY_TOKEN_ENCRYPTION_KEY in Vercel **production** as a sensitive environment variable; never commit it.
- [ ] Redeploy after adding environment variables and reconnect the Shopify OAuth app once.
- [ ] Verify encrypted session is stored in Upstash Redis; never expose the token or encryption key in logs, screenshots or chat.
- [ ] Verify read-only release-readiness authenticates with the stored session and correct shop.
- [ ] Verify least-privilege scopes and webhook subscription for orders/paid; missing permissions block release.

## Catalog and fulfillment
- [ ] Review every selected CJ SKU/variant, product title, images, Japanese descriptions, safety claims, dimensions and exclusions.
- [ ] Validate supplier inventory, landed cost, currency, shipping charge, delivery estimates, refunds and customs implications.
- [ ] Confirm Shopify product status is **draft** until explicitly approved; verify stock, variants, images and pricing.
- [ ] Test price-change, out-of-stock, discontinued product and delayed shipment exception paths.
- [ ] Confirm CJ sandbox test order, durable deduplication and tracking sync without real charges or shipments.
- [ ] Keep real CJ ordering, live fulfillment and paid ads disabled until separate explicit launch authorization.

## Legal and operational
- [ ] Confirm Japanese commerce disclosure (特定商取引法に基づく表記), contact information, privacy policy, returns/cancellation terms and shipping policy.
- [ ] Verify customer support escalation, refunds, delivery issues, taxes and payment gateway requirements.
- [ ] Check analytics and customer data retention/privacy practices.

## Final launch gate (separate action)
- [ ] Independent end-to-end order simulation passes, with no real customer charge or CJ fulfillment.
- [ ] Operator reviews and approves release checklist.
- [ ] Only then consider disabling storefront password and making approved products active.
