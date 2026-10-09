# AI BUYER — Sandbox release checklist

## Current release boundary

This application must **not** be considered ready for live, unattended fulfillment. CJ order creation is sandbox-only; live CJ payment, shipping tracking, and Shopify fulfillment synchronization have not been verified or enabled.

## Required Vercel environment variables (server only)

| Variable | Purpose |
| --- | --- |
| `SHOPIFY_CLIENT_SECRET` | Verify Shopify `orders/paid` webhook HMAC |
| `SHOPIFY_ALLOWED_SHOP_DOMAIN` | Exact merchant domain, e.g. `example.myshopify.com` (no scheme or slash) |
| `AI_BUYER_ADMIN_KEY` | Authenticate admin-only health and order diagnostics |
| `CJ_API_KEY` or `CJ_ACCESS_TOKEN` | CJ API authentication |
| `UPSTASH_REDIS_REST_URL` | Persistent order idempotency storage |
| `UPSTASH_REDIS_REST_TOKEN` | Persistent storage credential |
| `CJ_MAX_ITEMS_PER_ORDER` | Mandatory positive integer quantity limit |
| `CJ_MAX_ORDER_VALUE` | Mandatory positive maximum Shopify order total |
| `CJ_ORDER_LIMIT_CURRENCY` | ISO currency matching Shopify orders, e.g. `JPY` |
| `CJ_MAX_FREIGHT_USD` | Mandatory positive maximum CJ freight quote, denominated in USD |
| `CJ_SANDBOX_ORDER_ENABLED` | Set to `true` **only** for controlled sandbox tests |
| `SHOPIFY_FULFILLMENT_SYNC_ENABLED` | Explicit opt-in for Shopify tracking/fulfillment synchronization; enable only during controlled manual tests |

Do not expose secrets through client-side variables, repository files, screenshots or logs. Keep `CJ_ALLOW_REAL_SHOPIFY_ORDERS_IN_SANDBOX` unset during initial testing.

## Release gate

1. Confirm the Vercel deployment is `READY` and the expected GitHub commit SHA was deployed. A successful GitHub commit is **not** a successful deployment.
2. Register the `orders/paid` webhook to `/api/shopify-order-webhook` using the matching Shopify app secret and exact merchant domain.
3. With sandbox disabled, verify webhook handling fails closed; do not use real customer orders to test.
4. Set required server variables and enable sandbox only in a controlled environment. Query `GET /api/automation-health` with `Authorization: Bearer <admin key>`; require `sandboxReady: true` before testing.
5. Verify the USD freight ceiling is configured and that over-limit quotes fail closed. This does not verify margin or procurement cost.
6. Use a Shopify test order with a verified CJ variant ID, supported shipping address, currency and limits. Verify exactly one sandbox CJ order exists even after duplicate webhook delivery.
7. Query `GET /api/automation-order-status?shop=<shop>&orderId=<id>` with the admin key; verify the CJ order ID or a review-needed state.
8. Inspect `GET /api/automation-reconciliation` with the admin key. If `partial: true`, do not treat the list as exhaustive. Investigate every uncertain order manually; **never automatically retry an ambiguous CJ creation**.
9. Keep real payment and CJ live order creation disabled. Enable `SHOPIFY_FULFILLMENT_SYNC_ENABLED` only during controlled tracking-sync tests with a Shopify test order; disable it again afterwards.
10. Before enabling fulfillment sync, verify duplicate requests are skipped by Redis idempotency and ambiguous Shopify responses are left in `needs_review` rather than retried automatically.

## Known blockers

- The inherited commit `fad40c1` reports Vercel `build-rate-limit`. Do not force builds or create dummy commits. Deploy and verify the latest real change when the quota is available.
- CJ tracking and Shopify fulfillment routes are implemented, but real sandbox end-to-end validation is still pending. Source inspection counts 8 API entry points; confirm the deployed function count in Vercel.
- Existing order amount limits are based on Shopify sale value, **not** verified CJ procurement cost. They do not establish profitability.
- The order lookup stores the confirmed CJ order reference, not a complete delivery or payment lifecycle.

## Local safety regression checks

Run `node --test tests/*.test.mjs`. All external calls are mocked; these tests never create real orders, fulfillments, or payments.

- A saved `synced:<fulfillment GID>` is checked before Shopify fulfillment eligibility.
- `reserved`, `needs_review`, and unknown states block writes and never count as successful duplicate checks.
- `checkOnly:true` reads Redis only, even when the record is missing. It cannot create a fulfillment.
- Dry-run validates an uncancelled, paid Shopify test order and writes neither Redis nor Shopify.
- Split fulfillment orders require manual review; no arbitrary first-order selection.
- Real Shopify orders are rejected even if the legacy sandbox override is enabled.
- Old webhook URLs are displayed for manual review and never automatically removed. Pagination must complete before creating another subscription.
- Test progress is browser-local guidance, not proof of server safety or live readiness.

Reconciliation is paginated: follow `nextCursor` until `0`; `partial:true` means more records remain. Use `kind=fulfillment` for Shopify sync reservations. Results contain only hashed keys and allowlisted reason codes. No reservations are modified.

## Sandbox shipment simulation (2026-10-09)

CJ sandbox orders do not generate real shipment labels. After creating and reconciling a Shopify test order, use the **サンドボックスの追跡番号を作成** button, then read CJ tracking and synchronize Shopify. This uses only CJ's documented `shopping/sandbox/simulatePay` and `shopping/sandbox/updateTrackNumber` endpoints. It does not call a real payment API or create a real label.

The server obtains the CJ ID from the existing Redis Shopify-order mapping; the caller cannot supply arbitrary CJ IDs. CJ `isSandbox` must explicitly be true/1. Simulation actions use permanent Redis reservations. A timeout, rejection, or uncertain state blocks further attempts and appears under the simulation reconciliation queue. There is no automatic reset or retry. Parent-order batches and real CJ orders are not supported.

Shopify synchronization now reads the mapped CJ order again, requires its sandbox flag and matching tracking number, and requires a signed dry-run token valid for five minutes and bound to the exact order, tracking number and fulfillment order. Dry-run and duplicate checks do not create fulfillments. Existing completed results remain readable even after the fulfillment order closes.

The test administrator key is entered in a masked field and retained in the current page only. It is never written to local/session storage. Test evidence from older safety-check versions is invalidated, and release-readiness explicitly represents configuration checks rather than end-to-end completion.

References:
- https://developers.cjdropshipping.com/en/api/start/sandbox.html
- https://developers.cjdropshipping.com/en/api/api2/api/shopping.html

## Remaining external acceptance checks

- CJ public read-only connection and product discovery were observed working on the deployed app.
- The current browser reaches Shopify's sign-in screen; authenticated Shopify tests have not passed yet.
- Admin-key protected release-readiness, real Redis behavior, and real CJ sandbox simulation require authorized test access.
- Mock tests are not evidence of a successful external Shopify/CJ transaction. Do not mark release complete until the external checklist passes.
