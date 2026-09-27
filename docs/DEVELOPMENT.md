# FesFlow ローカル開発ガイド

最終更新: 2026-09-27

本番デプロイは [DEPLOY.md](./DEPLOY.md) を参照してください。ローカル API は Wrangler が D1/R2 をエミュレートするため、Cloudflare へのログインは不要です。

## 前提

- [Bun](https://bun.sh)（パッケージマネージャ兼ランタイム）
- Node.js は不要。Wrangler は API の開発依存関係に含まれます。

## セットアップ

```bash
bun install
bun run setup:local
```

`setup:local` は不足している場合だけルート `.env` を `.env.example` から作成し、`ENABLE_EMAIL_PASSWORD=true` と `VITE_ENABLE_LOCAL_AUTH=true` を未設定の場合に追加します。既存の値は変更しません。API の `apps/api/.dev.vars` が無い場合は `.env` へのリンクを作り、通常ファイルが既にある場合は保持したままローカル認証フラグだけ不足分を追加します。別のファイルを指す既存 symlink も上書きしません。

スクリプトは続けて **ローカルのみ**に D1 マイグレーションを適用し、再実行できるデモデータを投入します。リモート D1 のマイグレーションやデプロイは行いません。データは固定 ID のイベント、サークル、イベント/サークルのメンバーシップ、メニュー1件、来場者1人とリストバンド1本です。イベントは開催中、サークルは事前注文拡張を有効にし、メニューは在庫管理を有効にしています。管理画面でデモスペースを操作するには、ログイン画面から `demo@example.invalid` を使ってローカルアカウントを登録してください。パスワードはローカルで任意に決めます。アカウント認証情報はセットアップでは作成・保存しません。

`.env.example` の `BETTER_AUTH_SECRET` は説明用のダミー値です。必要ならローカル `.env` 内で置き換えてください。秘密値はコマンド引数やリポジトリへ書き込まないでください。アカウント自体はログイン画面から作成します。認証フラグはローカル用の `.env` / `.dev.vars` にのみ置きます。

## アプリとポート

| アプリ | 役割 | URL |
|---|---|---|
| `apps/api` | Hono Worker API (D1/R2, better-auth) | http://localhost:8787 |
| `apps/app` | 管理/模擬店/来場者向け React SPA | http://localhost:3000 |

管理画面の作業では、別ターミナルで API とアプリを起動します。

```bash
bun run dev:api
bun run dev:app
```

来場者の `/w/:id` や `/visitor/...` も同じ `apps/app` の `localhost:3000` で確認できます。

## 環境変数

Vite はルート `.env` を読み込みます（`apps/app/vite.config.ts` の `envDir`）。クライアントに公開されるのは `VITE_` で始まる変数です。Wrangler は `apps/api/.dev.vars` をローカル Worker の設定に使います。

ローカルでよく使う値:

- `VITE_API_URL=http://localhost:8787`
- `VITE_VISITOR_URL=http://localhost:3000`（同一アプリ内の来場者向けリンク）
- `VITE_STAFF_URL=http://localhost:3000`（店頭アプリへのリンク）
- `ENABLE_EMAIL_PASSWORD=true`（Wrangler ローカル開発のメール/パスワードログイン）
- `VITE_ENABLE_LOCAL_AUTH=true`（Vite 開発画面のメール/パスワード認証 UI）
- `INITIAL_SUPER_ADMIN_EMAIL`（初期システム管理者のローカル設定。デモメンバーシップには使われません）

ローカル `.env` を変更したら Vite と Wrangler を再起動してください。

## ローカル D1

`bun run setup:local` は次を実行します。

```bash
bun run db:migrate:local
bun scripts/seed-local-dev.ts
```

スキーマ変更後に既存ローカル DB へマイグレーションだけを適用する場合:

```bash
bun run db:generate
bun run db:migrate:local
```

ローカル DB は `apps/api/.wrangler/` 配下に作られます。デモデータ投入は固定 ID と `INSERT OR IGNORE` を使うため、`bun run setup:local` を繰り返しても同じ行を重複作成しません。来場者フローは `http://localhost:3000/w/dev-demo-wristband` から確認できます。任意の SQL を確認する場合:

```bash
cd apps/api
bunx wrangler d1 execute fesflow-db --local --command "SELECT id, event_name FROM event;"
```

コマンドに `--remote` を付けないでください。

## 型チェック・テスト・ビルド

```bash
bun run check-types
bun run test
bun run build
```

アプリ内の Bun テストを個別に実行する場合:

```bash
cd apps/app
bun test test/auth-context.test.ts
```

## よくある詰まり

- **API/アプリでローカル認証 UI が出ない**: `.env` の `VITE_ENABLE_LOCAL_AUTH` と API が読む `.dev.vars` の `ENABLE_EMAIL_PASSWORD` を確認してサーバーを再起動。
- **ログイン後にデモスペースがない**: アカウントのメールアドレスが `demo@example.invalid` と一致しているか確認し、`bun run setup:local` を再実行。
- **Wrangler が `(Y/n)` で止まる**: 必要なら `bunx wrangler telemetry disable` を一度実行。
- **ポートが使用中**: `3000` / `8787` を使うプロセスを停止するか、アプリ側の開発ポートを変更。

## 参考

- デザインシステム: [docs/DESIGN.md](./DESIGN.md)
- 本番デプロイ: [docs/DEPLOY.md](./DEPLOY.md)
