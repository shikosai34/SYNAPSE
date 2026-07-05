# @fesflow/db

FesFlow の Drizzle スキーマ / マイグレーション / DB 接続ファクトリを提供するパッケージ。

- `src/schema/*` — Drizzle テーブル定義 (auth / festival)。
- `src/migrations/*` — `drizzle-kit generate` で生成したマイグレーション。**手編集しない。**
- `src/index.ts` — `createDb(d1)` (Cloudflare D1) / `createLibsqlDb(url)` と、リクエストスコープの `db` プロキシを提供。

## ⚠️ シードスクリプト (ローカル専用)

リポジトリ直下の以下は **ローカル開発でのみ使う手動スクリプト** で、本番 Worker のバンドルには含まれない。

- `seed-wristband.ts` — `wb_admin_001` / `wb_test_00x` などの固定テスト用リストバンドを D1 に投入する。
- `seed-admin-wristband.ts` — 管理者アカウントに固定リストバンド `wb_admin_001` / 固定 AuthID を直接紐付ける。

これらが投入する固定IDは、セキュリティ監査 (2026-07-05) の C5「ハードコード管理者バックドア」対応で
**本番アプリの自動シードからは撤去済み**。手動検証用に残しているだけなので、以下を厳守すること。

- 実行は `bun run seed-wristband.ts` のように **手動** で、接続先が **ローカル D1** のときだけ。
- **本番 D1 (`--remote`) に対しては絶対に実行しない。** 推測可能なIDで有効な管理者 / テスト帯が
  生成され、なりすまし・不正ログインの経路になる。
