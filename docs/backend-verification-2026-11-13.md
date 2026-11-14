# ADPS backend verification — 2026-11-13

Historical percentage/completion claims in ADPS_MASTER.md are superseded by the evidence below. Mocked tests are not external acceptance evidence. Preview/UI work is deferred at the user's request.

## Implemented and exercised

- Manual sandbox ordering requires an explicitly marked, uncancelled Shopify test order and complete line-item pagination.
- Missing/invalid positive order limits and non-integer/non-positive quantities stop before reservations or CJ calls.
- Existing reservations, ambiguous results and malformed success records block repeated creation. Concurrent requests must win the Redis NX reservation.
- Missing persistence acknowledgement after CJ creation returns review-needed, never confirmed success.
- Reconciliation keeps unknown, malformed and missing SCAN/MGET records in review. Only kind-specific confirmed results are excluded.
- Order-status reads report corrupt records as review-needed and missing Redis response fields as unavailable.
- Production, live orders, payments, checkout and advertisements remain disabled by the existing controls.

## Tests

Run the repository regression suite:

```
node --test tests/*.test.mjs tests/*.test.cjs
```

Targeted additions cover normal/cancelled orders, incomplete line items, invalid limits and quantities, concurrent requests, duplicates, ambiguous creation, failed persistence, corrupt status records and reconciliation. External APIs are mocked; these tests create no customer orders or payments.

## Not established by these tests

- Fresh actual-product stock, freight, exchange-rate and margin evidence.
- External sandbox order through durable Redis, tracking and Shopify test fulfillment. Local simulation is not evidence of an actual supplier shipment/payment.
- Complete returns/claims handling with supplier acceptance and refund decisions. Risk scoring and return-policy metadata alone do not implement that lifecycle.
- Merchant-specific legal/business details and final release audit.

Keep these as outstanding acceptance checks. A passing test suite, build or UI label does not mark them complete.
