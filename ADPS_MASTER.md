# ADPS — Master decisions

> Current status (2026-11-13): Historical completion percentages below are not release evidence. See [backend verification](docs/backend-verification-2026-11-13.md) for verified changes and remaining acceptance checks.

## Brand separation (confirmed 2026-10-12)
- Customer-facing shop: **ODDLY**.
- Internal automation app: **ADPS**.
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

## Current release acceptance — 2026-11-15

Historical 99% / “remaining 1%” claims are withdrawn. Passing CI and a successful deployment do not establish operational readiness. See [launch acceptance](docs/launch-acceptance-2026-11-15.md).

- App name: **ADPS**. Store name: **ODDLY**.
- Initial assortment: pet products and related goods; exclude trademark conflicts and unsafe products.
- Target: product selection → verified preparation → Shopify DRAFT → final manual approval.
- No main merge, Production deployment, ACTIVE products, checkout, real CJ orders, advertisements or password removal without explicit user approval.
- Read-only connectivity, product-level evidence, external order/fulfillment verification and returns operations are separate acceptance gates.
- Code contains sandbox-only order handling; do not represent it as an implemented and verified live-order service.
- Verification results must identify the commit and the environment; no completion percentage without a defined acceptance denominator.
