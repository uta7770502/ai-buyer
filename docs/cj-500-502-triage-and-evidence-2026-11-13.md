# CJ 500/502 triage and release evidence gate (2026-11-13)

Status: **unresolved; no live CJ API request was made for this document**. GitHub Actions green is not proof of CJ connectivity, usable stock, or a deployable Preview.

## Diagnose in this order (read-only)

1. Correlate request ID, UTC timestamp, route, deployment SHA and sanitized HTTP status for **review 500** and **product detail 502**. Never log CJ tokens, raw response bodies, customer data or full upstream URLs containing identifiers.
2. Distinguish the HTTP status returned by ADPS from the upstream CJ HTTP status. A local 502 can mean malformed/non-JSON CJ responses, timeouts or a gateway error; do not label it a confirmed CJ outage without upstream evidence.
3. Check auth configuration without disclosing values: CJ_API_KEY present? CJ_ACCESS_TOKEN fallback present? token expiration/refresh? A 401/403 must not be treated as a transient 500 or retried indefinitely.
4. For product detail, record only Content-Type category, JSON parse success, CJ `result` flag, data shape and product-ID match. HTML with HTTP 200 must fail closed. Retry only bounded transient failures; 400 and auth failures are not retryable.
5. For reviews, determine whether 500 originated in the ADPS route, CJ upstream, response mapping or missing review evidence. Until verified, no product may pass the review gate.
6. Validate the same exact SKU/variant with real queryByVid evidence: CJ stock >= 5 is a separate launch gate; factory-only stock is a *candidate requiring verified replenishment*, not proof of immediately available CJ stock. Factory stock zero means unavailable. Do not invent a 2–3 day ETA.
7. Use actual Japan freight quotes, purchase cost, exchange rate and fees to calculate net margin >= 30%. Only explicitly approved SKU exceptions may use 25% or 20%; missing evidence blocks DRAFT.

## Evidence to record per SKU

| Evidence | Minimum fields | If absent |
| --- | --- | --- |
| CJ detail | timestamp, product ID, variant ID, upstream status, schema valid | reject |
| Review | source, sample count, score, complaint rate, timestamp | reject |
| Stock | variant ID, CJ quantity, factory quantity, timestamp | reject launch; label factory candidate only when factory > 0 |
| Japan freight | destination Japan, variant, method, quote amount/currency, timestamp | reject |
| Margin | cost, freight, exchange rate, payment/platform fees, price, verified net margin | reject |
| Deployment | branch SHA, Preview SHA, Ready status, actual safe GET HTTP result | mark unverified |

## Safety boundary

No main merge, Production deployment, Shopify ACTIVE, checkout enablement, actual CJ order, advertising or password removal without explicit approval. Read-only diagnostics and tests are permitted. Do not promote mocked values, estimated shipping or GitHub success checks into external acceptance evidence.
