# ODDLY prelaunch gate

This document is the operational gate for the final step before public launch.

## Must be green before launch
- CJ health: OK
- 9 draft product CJ freight checks: 9/9 OK
- CJ real-time stock dry-run: no supplier lookup failures
- Shopify draft products: all remain DRAFT until explicit approval
- Shopify inventory: synchronized only from verified CJ warehouse stock
- Inventory policy: DENY
- Product copy: Japanese review complete
- Shipping estimate: latest verified JP quote
- Safety/review gate: pass
- Legal/policy information: complete
- Shopify server auth/session: ready
- Order reconciliation: zero unresolved
- Sandbox order/fulfillment: verified
- Checkout/live publishing/ads: OFF until explicit approval

## Final explicit-approval step
Only after all gates are green:
1. Activate approved products.
2. Enable checkout.
3. Verify Shopify payment configuration.
4. Remove storefront password.
5. Keep real CJ order creation disabled until checkout validation is complete.

## Never auto-enable
- Product ACTIVE status
- Live checkout
- Real CJ orders
- Live ads
- Storefront password removal
