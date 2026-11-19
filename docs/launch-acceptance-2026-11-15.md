# ADPS launch acceptance — 2026-11-15

## Scope

ODDLY launch requires a verified purchase-to-delivery operation, not only a deployed ADPS interface. All publication, checkout, live ordering and advertising controls remain subject to explicit user approval.

## Evidence baseline

- Current audited source: `13e0566` on `safety-gate-20261024`.
- The earlier test-fixture fix `a51aa72` passed all eight GitHub PR workflows. That result is not acceptance evidence for later commits.
- Current Vercel connector cannot access this project's Preview (deployment lookup returns 404/access unavailable; listing previously returned 403). No authenticated live readiness audit was completed in this session.
- No real orders, payments, product activation or store changes were performed.

## Concrete gates

| Gate | Acceptance evidence | Current status |
| --- | --- | --- |
| External services | Authenticated read-only Admin, Storefront, webhook registration, scopes, CJ and Redis results from target environment | Not verified in this session |
| Product shortlist | Exact variant IDs, fresh stock/source, Japan freight and delivery window, verified net margin including advertising and refund allowance | Needs fresh external audit |
| Shopify drafts | Actual DRAFT status, inventory policy, Japanese descriptions, return conditions and evidence persisted for every selected product | Needs external audit |
| Order flow | Shopify test order → webhook → isolated CJ sandbox record → durable duplicate prevention → tracking → Shopify test fulfillment → zero unresolved records | Needs external acceptance; local mocks are insufficient |
| Returns and complaints | Intake, order matching, evidence collection, supplier claim/reference, decision, customer response and controlled refund handling | Complete implemented lifecycle not established; policy fields alone are insufficient |
| Merchant information | Actual seller/contact/payment/shipping/return data saved and reflected on the storefront | Merchant facts and store reflection need verification |
| Final authorization | Approved product list, verified operation and explicit approval of each production action | Not requested; prior gates incomplete |

## Release diagnostic correction

A successful HTTP diagnostic response must not conceal failed dependencies. The release endpoint now adds explicit blockers for unverified Admin, webhook, fulfillment scope, CJ and Storefront checks. Storefront failure also prevents prelaunchReady/safeToTest. Tests exercise each dependency independently and ensure raw service errors are not exposed and Shopify queries are read-only.

The endpoint still declares `readyForLive:false` and outstanding external verification. Do not remove these safeguards merely to display a green status. A durable evidence/approval mechanism must be designed and verified before replacing these conservative defaults.

## Next execution order

1. Restore authorized access to the `diogolf/adps` Preview and its authenticated diagnostics, then capture actual blockers without changing flags.
2. Resolve verified configuration issues and audit the selected drafts' stock/freight/margins.
3. Perform isolated external sandbox acceptance and record reconciliation evidence.
4. Complete and test returns/complaints operation and define the controlled transition from sandbox-only handling to real orders.
5. Review the evidence with the merchant, then request final publication authorization.
