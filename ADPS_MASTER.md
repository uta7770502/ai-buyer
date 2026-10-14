# ADPS / AI BUYER — Master decisions

## Brand separation (confirmed 2026-10-12)
- Customer-facing shop: **ODDLY**.
- Internal automation app: **ADPS / AI BUYER**.
- Never present ADPS PICKS, ADPS, or AI CURATED STORE as the shop brand.
- Do not market AI selection, generation, or dropshipping automation to customers. Applies to headers, product pages, FAQ, metadata, and structured data.

## Shop positioning
- Japanese online select shop, initially selling domestically.
- Categories are flexible: lifestyle goods, useful gadgets, fashion accessories, gifts and other compelling products.
- Highlight real product utility, distinctive qualities and use cases.
- Overseas expansion is future consideration, not current promise.

## Design direction
- Combine the product-discovery appeal of Uncommon Goods with A24-like editorial visual direction.
- Preserve existing implementation and refine it; do not redesign from scratch without reason.
- Existing working palette: off-white, black, lime accent. Large editorial typography, cards, thematic banners, category entry points, search, favorites, product details, cart, shipping/returns guide and FAQ.
- Prioritize mobile shopping UX and clear browse -> detail -> purchase flow.
- Existing design choices are a baseline, not all final approvals.

## Accuracy / AIO-GEO
- Keep customer-facing text and structured data consistent.
- Only use verified product facts, prices, inventory, shipping, returns and ratings. No invented reviews, popularity ranks, free-shipping promises or arrival estimates.
- Clearly separate demo content from live Shopify/CJ data.

## Operational safety
- Internal goal: choose products, automate the remaining workflow where safe and verified.
- Do not enable real CJ auto-orders or live payment flows before thorough end-to-end sandbox testing and explicit production approval.
- GitHub code may lag behind later decisions; this document records approved product/brand decisions.

## Handoff protocol
- Read this document before modifying storefront copy, branding or customer-facing behavior.
- Verify actual deployment separately from GitHub commits.
- Update this document whenever a new decision supersedes these requirements.

<!-- Deployment trigger after Git reconnect: 2026-10-12 -->

<!-- Production retrigger after reconnect: 2026-10-12T20:45+09:00 -->

<!-- Hobby-limit retrigger: 2026-10-12T20:53+09:00 -->

<!-- Rate-limit retest: 2026-10-14T09:10+09:00 -->

## 2026-10-14 implementation completion status

The following implementation work is complete and is the current baseline:

1. **ODDLY storefront design polish** — complete.
   - Mobile-first layout, search, favorites, cart, product detail and responsive hero treatment are implemented.
2. **AIO / GEO foundation** — complete.
   - ODDLY branding is aligned across visible copy, structured data, product URLs and llms.txt.
   - Unverified reviews, popularity, shipping or delivery claims must not be emitted.
3. **Shopify real-product storefront integration** — complete in code.
   - Live storefront data is treated as authoritative; demo content remains isolated to preview mode.
4. **Japan-first product page enrichment** — complete.
   - Product summary, intended audience, ODDLY recommendation points, stock, shipping and returns are supported.
5. **“Select a product and let AI BUYER prepare the rest” flow** — complete through safe draft preparation.
   - Selection → CJ freight lookup → safe price calculation → Shopify draft → Japan-oriented page optimization → publication queue.
   - Automatic preparation explicitly sends `publishApproved:false`.
6. **CJ / Shopify safety layer** — complete in code.
   - Shopify real orders are rejected by the sandbox webhook.
   - CJ order creation is sandbox-only.
   - Durable Redis idempotency, duplicate prevention, HMAC verification, SKU/VID checks, order/freight limits, ambiguous-result stop conditions and tracking preflight checks are implemented.

### Not yet production-approved

The only remaining requirement before enabling any live commerce automation is a **fresh, real end-to-end sandbox verification in the deployed environment**:
- signed Shopify test-order webhook delivery
- Shopify variant ↔ CJ VID mapping
- CJ sandbox order creation/reconciliation
- durable Redis duplicate protection
- sandbox tracking simulation
- Shopify test fulfillment/tracking sync
- zero unresolved reconciliation items

These checks must be fresh (within 24 hours in the UI readiness gate).

Until that evidence exists:
- keep `SHOPIFY_LIVE_PUBLISH_ENABLED` disabled
- keep real CJ ordering/payment disabled
- do not treat `safeToTest` as production approval
- keep search indexing gated until real product content is ready for public indexing

## 2026-10-14 pre-production 99% milestone

The application is now considered **99% complete before production lock release**.

### Completed at the 99% milestone
- ODDLY storefront UI and mobile layout
- Shopify live-product storefront integration
- Japan-first product pages
- AIO/GEO visible copy, structured data, llms.txt and sitemap gating
- Search indexing safety: incomplete AIO/GEO product pages remain noindex and are excluded from the sitemap
- Product-selection-only automation through Shopify draft preparation
- CJ freight lookup and safe price preparation
- Shopify Admin read-only connectivity verification
- Shopify ORDERS_PAID webhook registration verification
- Shopify fulfillment write-scope verification
- CJ API read-only connectivity verification
- Redis reachability verification
- Sandbox-only CJ order creation
- Safe sandbox E2E preflight button
- Sandbox payment/tracking simulation
- Shopify test fulfillment preflight and tracking sync
- Automatic duplicate-sync verification
- Automatic reconciliation summary after test tracking sync
- Fresh-evidence readiness gates
- Local “live” status blocked unless Shopify product is actually published
- Live Shopify publication locked behind explicit server opt-in and explicit publish approval
- Live ad spend blocked unless ADS_LIVE_ENABLED is explicitly enabled
- Real CJ payment/order flow remains disabled

### Production locks that must remain OFF at 99%
- `SHOPIFY_LIVE_PUBLISH_ENABLED`
- `ADS_LIVE_ENABLED`
- any real CJ ordering/payment path
- search indexing until real product content is approved

### Remaining 1% to reach 100%
Do not count this as implementation work. It is the production activation phase:
1. Run one fresh end-to-end sandbox order in the deployed environment.
2. Confirm webhook delivery, CJ sandbox creation, tracking, Shopify test fulfillment, duplicate prevention, and zero unresolved reconciliation items.
3. Approve real product content for indexing.
4. Only then enable production publication / search / advertising / real-order controls one by one with explicit approval.

Until those checks are complete, the product is **99% complete, production-locked, and safe to continue testing**.
