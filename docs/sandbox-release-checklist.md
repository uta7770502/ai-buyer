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
| `CJ_SANDBOX_ORDER_ENABLED` | Set to `true` **only** for controlled sandbox tests |

Do not expose secrets through client-side variables, repository files, screenshots or logs. Keep `CJ_ALLOW_REAL_SHOPIFY_ORDERS_IN_SANDBOX` unset during initial testing.

## Release gate

1. Confirm the Vercel deployment is `READY` and the expected GitHub commit SHA was deployed. A successful GitHub commit is **not** a successful deployment.
2. Register the `orders/paid` webhook to `/api/shopify-order-webhook` using the matching Shopify app secret and exact merchant domain.
3. With sandbox disabled, verify webhook handling fails closed; do not use real customer orders to test.
4. Set required server variables and enable sandbox only in a controlled environment. Query `GET /api/automation-health` with `Authorization: Bearer <admin key>`; require `sandboxReady: true` before testing.
5. Use a Shopify test order with a verified CJ variant ID, supported shipping address, currency and limits. Verify exactly one sandbox CJ order exists even after duplicate webhook delivery.
6. Query `GET /api/automation-order-status?shop=<shop>&orderId=<id>` with the admin key; verify the CJ order ID or a review-needed state.
7. Inspect `GET /api/automation-reconciliation` with the admin key. If `partial: true`, do not treat the list as exhaustive. Investigate every uncertain order manually; **never automatically retry an ambiguous CJ creation**.
8. Keep real payment, CJ live order creation, Shopify fulfillment updates and customer tracking notifications disabled until end-to-end integration tests and operational controls pass.

## Known blockers

- Vercel build logs could not be read due to team-scope authorization errors. The observed production deployment was `ERROR`; investigate in the authorized Vercel team account.
- CJ tracking API integration and Shopify fulfillment-order mutations are not yet implemented and validated.
- Existing order amount limits are based on Shopify sale value, **not** verified CJ procurement cost. They do not establish profitability.
- The order lookup stores the confirmed CJ order reference, not a complete delivery or payment lifecycle.
