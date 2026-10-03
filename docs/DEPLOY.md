# FesFlow リリース手順

最終更新: 2026-10-03。リリースは担当者が対象環境と変更内容を確認して実施する。本資料を更新しただけでは本番設定、D1、DNS、Cloudflare Dashboardを検証したことにならない。

## 現在のworkspaceとroute

- `apps/app`: React SPA。Workers Static Assetsの設定 `apps/app/wrangler.jsonc`。
- `apps/api`: Hono Worker。D1/R2の設定 `apps/api/wrangler.jsonc`。
- 両方とも `fesflow.shikosai.net` を使い、API routeは `/api/*`。昔の`register`/`visitor`複数appや別APIドメインへのリリースコマンドは使わない。
- `bun run build` はSPAと、deploy flagなしのAPI dry-run bundleを作成する。

## PRでの確認

GitHub Actions `Quality / verify` はBun 1.3.13 / Node 22を使い、frozen-lockfile install、npm+OSV security audit、typecheck、test、SPAとWorkerのbuildを実行する。PRにproduction secretは渡さない。main/devのPR protectionで`Quality / verify`をrequired checkに設定するのはrepo administratorの操作。

## 本番リリース確認

以下を順番に行い、リリース記録に対象commitと結果を書く。

1. mainの承認済みcommitから開始し、working tree・CI・生成migrationを確認する。
2. Cloudflare accountとplan、`apps/app/wrangler.jsonc` / `apps/api/wrangler.jsonc` のroute、D1 ID、migration履歴、R2 bindingをdashboard/Wranglerで照合する。**レポジトリに書かれた値だけから本番を推測しない。**
3. D1 backup/exportと復元手順を確認する。SQL migrationの追加・index・foreign key・元データ移行の影響を検査する。
4. Migrationが必要なら、対象databaseと適用済み履歴を再確認してからリモート適用し、適用一覧を再読込する。Migration失敗時にデータへ手を加える前に停止する。
5. 必要なAPI Worker / SPAだけをそれぞれの`deploy` scriptでデプロイする。コマンドはWorkers APIへの変更を行うため、リリースオーナーによる明示的な実行判断が必要。
6. production URLでHTTP、ログイン/session、circle/event権限、注文作成と再送、状態変更、asset配信を確認する。管理者データを書き込む確認は影響範囲を先に決める。
7. request IDを使ってAPI logを確認し、5xx・latency・D1計測を監視する。異常時はWorker/SPAの既知正常版に戻し、互換性が確認されるまでD1を手動で巻き戻さない。

## ローカルとproductionの境界

`bun run setup:local`, `bun run db:migrate:local`, Wrangler `--local`はローカルD1だけを変更する。手順を読み替えて`--remote`を付けることはない。Production環境の値やsecret、remote D1、Cron、負荷試験は今回変更・実行していない。

## 運用判断

60日の保持期間と削除対象、イベント終了後の業務記録保存、開催再開時の時計は正式確認待ち（[#83](https://github.com/shikosai34/SYNAPSE/issues/83)）。本番でCleanup dry-runを先に実施し、件数とbackup復元経路を照合する。詳細は[運用・承認待ち](OPERATIONS.md)、システム境界は[アーキテクチャ](ARCHITECTURE.md)を参照。
