# ADPS release gate — 2026-11-16 (backend-only audit)

Status: **NOT READY FOR PRODUCTION**. This document does not certify live CJ/Shopify integration.

## Mandatory fail-closed acceptance criteria

- Recommendation: reject missing/invalid review count, rating, low-rating share, complaint evidence, provenance or inconsistent CJ response; do not infer positive evidence from absent fields.
- Margin: calculate *net* margin after product cost, actual destination shipping, platform/payment fees, refunds reserve and currency conversion; default minimum 30%. Allow 25% or 20% only with explicit SKU-bound approval and complete cost evidence. No approval for unknown shipping/fees.
- Inventory: distinguish immediately available CJ warehouse stock (minimum five) from factory stock requiring 2–3 days; never publish factory stock as immediately available Shopify quantity. Reject malformed/negative/noninteger stock and out-of-stock products.
- Shopify: only authenticated idempotent DRAFT creation; verify Japanese copy, factual claims, images, variant price, shipping disclosures and duplicate protection. Never activate products automatically.
- Orders/returns/tracking: mocks only until idempotency, retries, signatures, refunds and state transitions are audited; no real CJ order creation or Shopify inventory writes.
- Auth: require administrator authentication and server-side authorization for each mutating route, with replay protection and audit logging.

## Evidence still required before launch

1. Latest commit's complete CI matrix green; passing unit tests do not prove external integrations.
2. Trace SKU margin-exception helper through the actual recommendation endpoint and prove that a 25%/20% exception cannot bypass other safety gates.
3. CJ live read-only warehouse/factory inventory and Japan shipping quotes with timestamps, SKU and destination; reconcile final net margin.
4. Shopify test-store DRAFT read-back of Japanese title/description, variants, prices, images, shipping and status.
5. Mock lifecycle: duplicate webhooks, missing signatures, retry races, cancellations, refunds and tracking updates.
6. Preview authentication and UI end-to-end verification, separately approved deployment.

## Prohibited actions

No main merge, Production deployment, ACTIVE products, Checkout/ads enablement, password removal, real CJ orders or Shopify inventory writes. PR #35 stays draft pending evidence.
