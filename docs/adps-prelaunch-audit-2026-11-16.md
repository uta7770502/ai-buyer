# ADPS prelaunch safety audit — 2026-11-16 08:54 JST

Scope: `safety-gate-20261024`, PR #35. This is a **read-only audit record**, not launch approval.

## CI observed
At head `8f936369d181d545918a1f7e7aaf515bdd81e730`, 11 pull-request workflow runs returned `completed/success` (CJ inventory, CJ risk, draft/net margin, English localization, verified margin, Shopify readiness auth, webhook safety, publish server auth, ODDLY safety/profit, tracking, encrypted session). A Vercel commit status returned success; this is **not** proof of a working Preview or production deployment.

## Release-blocking evidence not yet established
- [ ] Confirm actual recommendation path invokes fail-closed review/complaint/evidence checks (not only unit-tested helpers).
- [ ] Confirm the SKU-specific 25%/20% exception is wired to the actual recommendation path; default must remain 30%.
- [ ] Verify real Japan shipping quote, processing/payment fees, refunds reserve and final net margin from server-trusted sources; fail closed if missing or stale.
- [ ] Confirm CJ warehouse count >=5 independently of factory stock; factory replenishment 2–3 days must never be presented as immediately available Shopify stock.
- [ ] Validate live CJ API responses, rate limiting and out-of-stock transitions without making CJ orders.
- [ ] Verify Shopify DRAFT-only creation and Japanese copy, images, prices and delivery statements using non-public sandbox/mocks; ensure no ACTIVE transition.
- [ ] Test admin authentication, idempotency and concurrency for duplicate writes; no inventory writes.
- [ ] Mock order, refund/return and tracking workflows with signed webhooks and replay protection; no real order.
- [ ] Run comprehensive regression suite and document coverage gaps, including edge cases in external API errors.
- [ ] Check Preview manually only when deployment is explicitly authorized.

## Hard safety constraints
No main merge, Production release, ACTIVE products, Checkout/ads activation, password removal, real CJ order, or Shopify inventory write. CI green alone does not remove any release blocker.

## Implementation observation
`lib/adps-approved-sku-margin.mjs` explicitly describes itself as a helper that does not authorize publishing. Confirm call-site integration before claiming the margin exception is enforced end-to-end.
