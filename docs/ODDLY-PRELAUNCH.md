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


## Final prelaunch configuration added in 2026-10
Before launch, set the following **public business information** in Vercel Production. These values are intentionally not invented by the application.

- `ODDLY_SELLER_NAME` — 販売業者名
- `ODDLY_REPRESENTATIVE_NAME` — 運営責任者
- `ODDLY_SELLER_ADDRESS` — 所在地
- `ODDLY_SUPPORT_PHONE` — 問い合わせ電話番号
- `ODDLY_SUPPORT_EMAIL` — 問い合わせメール
- `ODDLY_PAYMENT_TIMING` — 支払時期
- `ODDLY_SHIPPING_WINDOW` — 商品引渡時期
- `ODDLY_RETURN_DAYS` — 返品受付日数（正の整数）
- `ODDLY_RETURN_CONDITIONS` — 返品・交換条件
- `ODDLY_RETURN_SHIPPING` — 返品送料の負担条件
- `ODDLY_ADDITIONAL_FEES` — 商品代金以外に必要な料金（送料等）
- `ODDLY_PRIVACY_CONTACT` — 個人情報問い合わせ先
- `ODDLY_POLICY_UPDATED_AT` — ポリシー更新日（表示用、任意）

The storefront policy page is `/policies`. If any required value is missing, `legalReady=false` and checkout stays unavailable.

## Checkout launch switch
- `ODDLY_CHECKOUT_ENABLED=false` during all prelaunch work.
- The storefront checkout button stays disabled unless **both** `legalReady=true` and `ODDLY_CHECKOUT_ENABLED=true`.
- When enabled, the app creates a Shopify Storefront cart server-side and redirects to Shopify's checkout URL. No Storefront access token is exposed to the browser.
- Keep this flag **false** until the final launch action.

## Automated prelaunch READY definition
The protected release-readiness check reports `prelaunchReady=true` only when:
- Shopify Admin encrypted server session works.
- Shopify Storefront API works.
- ORDERS_PAID webhook is verified.
- Required fulfillment scope is verified.
- CJ API and Redis are reachable.
- Sandbox ordering and fulfillment-sync safety limits are configured.
- Legal/public policy information is complete.
- Real CJ orders, live product publishing, paid ads, and storefront checkout are still OFF.

## Final launch action — do not perform during prelaunch
Only after all tests are green:
1. Confirm Shopify payment provider is enabled using Shopify Admin test mode / approved test method.
2. Confirm the exact approved products and prices one last time.
3. Enable only the approved Shopify products.
4. Set `ODDLY_CHECKOUT_ENABLED=true` and redeploy.
5. Confirm checkout opens Shopify with the expected cart, totals, shipping, tax and payment options.
6. Remove storefront password protection last.
7. Keep live CJ auto-ordering and paid ads disabled until the first controlled live order is reviewed.
