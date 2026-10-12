# AI BUYER CJ接続版 v8

CJdropshipping API接続を前提にしたAI BUYERプロトタイプ。

## v8の主な機能
- CJ商品検索 / 商品詳細取得
- AIスコアリング / 今日のおすすめ自動生成
- 監視キーワード / 自動探索 / 除外ルール
- 販売候補・テスト・販売のステータス管理
- 閲覧数 / 注文数 / 広告費 / 返品数からCVR・ROAS・実利益を算出
- 実績に応じたAIスコア補正
- テスト終了の自動判定
  - 勝ち商品: 販売へ自動昇格
  - テスト継続: データを追加収集
  - 停止候補: 候補へ戻し、停止フラグを付与
- 停止候補を手動で再テスト可能
- CSV出力

## 本番接続
Vercelで `CJ_API_KEY` を環境変数に設定し、`/api/cj-search` と `/api/cj-detail` からCJ APIを呼び出す。
APIキーやAccess Tokenはブラウザ側へ直接埋め込まない。

## v12 monitoring additions
- `/api/cj-monitor` checks current CJ product price and inventory by product ID.
- Front-end compares the current price/inventory with the prior snapshot.
- Alerts: stockout, low stock, CJ price rise, margin deterioration.
- Severe stockout/margin deterioration marks the product as a stop candidate.
- Monitoring history and operational log are stored locally in the browser.
- Automatic monitor runs at app launch when 24 hours have elapsed (can be disabled).

Current CJ endpoints used:
- Product detail: `/api2.0/v1/product/query?pid=...`
- Inventory by product ID: `/api2.0/v1/product/stock/getInventoryByPid?pid=...`

## v13 readiness additions
- `/api/cj-health` validates authentication and a lightweight CJ category request.
- Connection status appears in the home screen.
- Supply risk uses the most recent 7 monitor snapshots (up to 30 stored per product) to detect price volatility and stock deterioration.
- JSON backup/restore covers product candidates, monitoring, AI learning, settings and history.

## Storefront AIO / GEO product metadata

The customer-facing storefront reads optional Shopify product metafields from the `custom` namespace and uses them in visible product copy, search, product FAQs and structured data.

Recommended metafields:

- `custom.adps_audience` — short description of who the product is for.
- `custom.adps_summary` — concise factual product summary.
- `custom.adps_why` — ADPS selection reasons, separated by new lines or `|`.
- `custom.shipping_price_jpy` — numeric shipping price in JPY.
- `custom.shipping_country` — ISO country code, initially `JP`.
- `custom.return_days` — positive integer return window.

The metafield definitions must be exposed to the Shopify Storefront API before the public feed can read them.

Production rule: only factual, current Shopify product data may be treated as authoritative. Demo values, inferred review scores and unverified shipping/return claims must not be emitted as live commerce structured data.


## Shopify/CJ sandbox tracking verification (safe runbook)

The tracking write endpoint is **disabled by default**. Do not enable it for real orders.
It requires a CJ sandbox order previously linked to a Shopify test order in Upstash Redis.

1. Confirm the GitHub Actions **Tracking safety tests** workflow passes on `main`.
2. Verify Vercel has `SHOPIFY_ALLOWED_SHOP_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `AI_BUYER_ADMIN_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and CJ sandbox credentials configured. Do not expose values in screenshots or logs.
3. Use a Shopify **test** order paid with test mode, fulfilled by an existing confirmed CJ **sandbox** order. Do not create a real shipment or pay CJ.
4. Read-only check: `GET /api/cj?action=order-tracking&shopifyOrderId=TEST_ORDER_ID` with `Authorization: Bearer <ADMIN_KEY>`. Review `syncState`, `eligibleForSync`, `trackingSource` and `shopifySyncVerified`.
5. Only for an approved test order with verified CJ shipment and `eligibleForSync: true`, temporarily set `CJ_SANDBOX_TRACKING_SYNC_ENABLED=true` in the isolated test deployment, then call `POST /api/cj?action=tracking-sync` with JSON `{"shopifyOrderId":"TEST_ORDER_ID"}` and the same authorization header.
6. Confirm the exact Shopify fulfillment ID and tracking number are present. Disable `CJ_SANDBOX_TRACKING_SYNC_ENABLED` after the test.

**Important:** Any `needsReview` response means stop; inspect both Shopify and CJ manually. Never automatically repeat a write request after an ambiguous result. Redis stores an idempotency marker that deliberately blocks automatic reattempts. The endpoint never creates CJ orders or charges payment.

These checks are not proof of a production-ready integration. GitHub Actions checks source contracts and syntax only; a real end-to-end sandbox run is required separately.

## Preflight readiness (admin-only)

Use the deployed **test environment** to request `GET /api/cj?action=readiness` with `Authorization: Bearer <AI_BUYER_ADMIN_KEY>`. Do not put the key in a query string or browser address bar.

- `readinessStatus=configuration_incomplete`: follow the `remediation` items and re-check.
- `readinessStatus=awaiting_live_verification`: configuration is present, **not** validated. The five `nextChecks` remain unverified.
- `summary.configuredChecks` counts configured settings; `summary.remainingExternalChecks` counts unverified integration steps. Neither is an app-completion percentage.
- Both `CJ_SANDBOX_ORDER_ENABLED` and `CJ_SANDBOX_TRACKING_SYNC_ENABLED` must remain disabled except during separately authorized, isolated sandbox tests.
- Verify Shopify webhook delivery, SKU mapping, CJ sandbox order reconciliation, Redis idempotency, and Shopify test fulfillment with recorded evidence before enabling any live automation.
- Never paste API keys or bearer tokens into GitHub issues, screenshots, public logs, or this checklist.

**Safety gate:** An all-green configuration check does not authorize real CJ purchases. A human must verify the complete sandbox flow and approve any subsequent production rollout.
