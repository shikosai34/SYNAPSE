# FesFlow ローカル開発ガイド

最終更新: 2026-07-04

このドキュメントは、ローカルマシンで FesFlow を開発・動作確認するための手引きです。
本番デプロイは [DEPLOY.md](./DEPLOY.md) を参照してください。

> ローカルでは D1(SQLite) と R2 は Wrangler が Miniflare でエミュレートするため、
> **Cloudflare アカウントやログインは不要**・オフラインで動きます。

## 前提

- [bun](https://bun.sh)（パッケージマネージャ兼ランタイム）
- Node.js は不要（bun で完結）。Wrangler は devDependency として同梱。

## セットアップ (初回)

```bash
# 1. 依存インストール
bun install

# 2. 環境変数を用意
#    ルートに .env を作成し、apps/api/.dev.vars → ../../.env のシンボリックリンクを張る
bun run setup:env

# 3. ローカル D1 にスキーマ適用 (0000〜最新のマイグレーション)
bun run db:migrate:local

# 4. 全アプリの開発サーバーを起動
bun run dev
```

## アプリとポート

| アプリ | 役割 | URL |
|---|---|---|
| `apps/api` | バックエンド (Hono Worker, D1+R2, better-auth) | http://localhost:8787 |
| `apps/register` | スタッフ/イベント/システム管理 SPA | http://localhost:3000 |
| `apps/visitor` | 来場者 SPA (入場/オンボ/マイページ) | http://localhost:3001 |

個別起動:

```bash
bun run dev:api        # :8787
bun run dev:register   # :3000
bun run dev:visitor    # :3001
```

## 環境変数 (ローカル)

ルートの `.env` を **api と 全フロントで共有**します（テンプレートは [.env.example](../.env.example)）。

- **API** は `apps/api/.dev.vars`（= `.env` へのシンボリックリンク）から読み込む。
  `.dev.vars` は `wrangler.jsonc` の `vars`（本番値）を**ローカルでは上書き**する。
- **フロント (Vite)** は `VITE_` 接頭辞の変数のみ露出。`envDir` がリポジトリルートなので
  ルート `.env` を読む。主なもの:
  - `VITE_API_URL`（既定 `http://localhost:8787`）
  - `VITE_VISITOR_URL`（register→来場者アプリ転送用, 既定 `http://localhost:3001`）
  - `VITE_REGISTER_URL`（visitor のマイページQR用, 既定 `http://localhost:3000`）
- `BETTER_AUTH_SECRET` はローカルでも 32 文字以上の適当なランダム文字列を入れておく。

> `.env` を書き換えたら、フロントは Vite 再起動、API は wrangler 再起動で反映されます。

## 初期データの投入

新規の空 DB では管理者もイベントも無いので、最低限これを行います。

### 1. 管理者アカウントを作る
`http://localhost:3000/login` で **`.env` の `INITIAL_SUPER_ADMIN_EMAIL` と同じメール**で
サインアップすると、初回ログイン時に自動で `super_admin` メンバーシップが付与されます。

### 2. イベントを1件作る
来場者の入場 (`/w/:id`) は対象イベントが最低1件ないと外部キー制約で 500 になります。
管理画面から作るか、ローカル D1 に直接投入します:

```bash
cd apps/api
bunx wrangler d1 execute fesflow-db --local --command \
  "INSERT OR IGNORE INTO event (id, event_name, created_at, updated_at) \
   VALUES ('evt_demo','デモ学園祭', \
   (cast(unixepoch('subsecond')*1000 as integer)), \
   (cast(unixepoch('subsecond')*1000 as integer)));"
```

## 来場者フローのローカル確認

1. リストバンド入場: `http://localhost:3001/w/wb_test_v1`
   - `wb_test*` / `wb_admin*` で始まるコードは lookup 時に eventUser が自動シードされます
     （※上記のイベント投入が前提）。
2. オンボーディング（ニックネーム＋誕生日）→ マイページに遷移。
3. マイページの店頭QRは `VITE_REGISTER_URL/checkin?wb=...`（既定 :3000）を指します。

## データベース操作

| コマンド | 説明 |
|---|---|
| `bun run db:generate` | `packages/db` のスキーマ変更から SQL マイグレーションを生成 |
| `bun run db:migrate:local` | 生成済みマイグレーションをローカル D1 に適用 |
| `bun run db:studio` | Drizzle Studio でローカル DB を GUI 閲覧 |

スキーマを変更したら **`db:generate` → `db:migrate:local`** の順で反映します。
ローカル D1 の実体は `apps/api/.wrangler/` 配下。作り直したいときはこのディレクトリを消して
再度 `db:migrate:local` します。

任意の SQL を流す:

```bash
cd apps/api
bunx wrangler d1 execute fesflow-db --local --command "SELECT * FROM event;"
```

## 型チェック / ビルド

```bash
bun run check-types   # 全パッケージ (turbo)
bun run build         # 全アプリのビルド (turbo)
```

## よくある詰まり (トラブルシュート)

- **来場者 `/w/:id` が 500**: 対象イベントが無い。上記「イベントを1件作る」を実行。
- **ログインは通るがセッションが保たれない**: better-auth の `trustedOrigins` に該当オリジンが
  必要。ローカルの `localhost:3000/3001` はコード側でハードコード済み
  （[packages/auth/src/index.ts](../packages/auth/src/index.ts)）。ポートを変えた場合は要追加。
- **wrangler が `(Y/n)` で止まる**: 初回のテレメトリ同意プロンプト。
  一度 `bunx wrangler telemetry disable` で無効化（deploy スクリプトは対策済み）。
- **API 変更が反映されない**: `wrangler dev` は基本ホットリロードするが、`wrangler.jsonc` や
  `.dev.vars` を変えたら再起動。
- **ポート衝突**: 3000/3001/8787 を使うプロセスを停止するか、`vite --port` を変更。

## 参考

- ディレクトリ構成・技術スタック・開発ルール: [README](../README.md)
- デザインシステム: [docs/DESIGN.md](./DESIGN.md)
- 本番デプロイ: [docs/DEPLOY.md](./DEPLOY.md)
