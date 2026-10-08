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
