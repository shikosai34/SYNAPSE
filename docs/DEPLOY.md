# FesFlow 本番デプロイ手順 (Cloudflare)

最終更新: 2026-07-04

## ドメイン構成

| 用途 | ドメイン | Worker |
|---|---|---|
| 来場者 (visitor) | `fesflow.shikosai.net` | `fesflow-visitor` |
| スタッフ (register) | `staff.fesflow.shikosai.net` | `fesflow-register` |
| 管理 (register) | `admin.fesflow.shikosai.net` | `fesflow-register`(同一) |
| API (Hono Worker) | `api.fesflow.shikosai.net` | `fesflow-api` |

- register は1つのSPA。staff/admin の2ドメインを同じ Worker に割り当て、アプリ内でロール別にセクション分けする。
- 認証Cookieは `sameSite=none; secure`。全て `*.shikosai.net` の同一サイト配下なので、サードパーティCookieブロックの影響を受けにくい。

## 前提 (Cloudflare 側で一度だけ)

1. **ゾーン `shikosai.net`** がデプロイ先アカウントにあること（`custom_domain` ルートはゾーンが必要）。
2. **D1 データベース**: `bunx wrangler d1 create fesflow-db` 済みで、表示された `database_id` が [apps/api/wrangler.jsonc](../apps/api/wrangler.jsonc) の値と一致していること。**現在の値が本番IDか要確認**（ローカル用の仮値なら差し替える）。
3. **R2 バケット**: `bunx wrangler r2 bucket create fesflow-uploads`。

## 手順

### 1. API の機密を登録 (secret)

`.dev.vars` はローカル専用でデプロイされない。本番は secret で登録する。

```bash
cd apps/api
bunx wrangler secret put BETTER_AUTH_SECRET   # 32文字以上のランダム文字列
```

> 非機密の `BETTER_AUTH_URL` / `CORS_ORIGIN` / `INITIAL_SUPER_ADMIN_EMAIL` / `R2_PUBLIC_URL` は
> [apps/api/wrangler.jsonc](../apps/api/wrangler.jsonc) の `vars` に本番値を記載済み
> （ローカル開発では `.dev.vars` が上書きする）。

### 2. リモート D1 にマイグレーション適用

```bash
bun run db:migrate:remote   # 0000〜0002 (来場者機能スキーマ含む) を本番D1へ
```

### 3. ビルド

本番URLは [.env.production](../.env.production) から `vite build` 時に自動で焼き込まれる。

```bash
bun run build
```

### 4. デプロイ

```bash
bun run deploy            # turbo が build 依存込みで api / register / visitor を全デプロイ
# もしくは個別:
#   (cd apps/api && bunx wrangler deploy)
#   (cd apps/register && bunx wrangler deploy)
#   (cd apps/visitor && bunx wrangler deploy)
```

初回デプロイ時、`custom_domain` ルートが各ドメインのDNS(CNAME/プロキシ)を自動作成する。

### 5. 初期データ / 動作確認

1. `admin.fesflow.shikosai.net` で **`sato.t.5970@gmail.com`** としてサインアップ
   → 初回ログイン時に自動で `super_admin` メンバーシップが付与される。
2. イベントを1件作成（来場者の `/w/:id` 入場はイベントが最低1件ないと FK エラーになる）。
3. 来場者フロー確認: リストバンドQR `https://fesflow.shikosai.net/w/<id>` → オンボーディング → マイページ。
4. ログイン/セッションがクロスオリジンで通ること（3フロント全て）を確認。

## 非対話デプロイ (プロンプトで止まる問題)

wrangler は初回に「テレメトリ送信に協力しますか? (Y/n)」を対話で尋ね、ターミナルに
入力できない環境ではここで停止する。対策済み:

- 各アプリの `deploy` スクリプトは `CI=true WRANGLER_SEND_METRICS=false wrangler deploy`
  で完全非対話化してある（どのプロンプトも待たずに進む/失敗する）。
- マシン全体で無効化するには一度だけ `bunx wrangler telemetry disable`。

## トラブルシュート

- **ログインは通るがセッションが保持されない**: better-auth の `trustedOrigins` に該当フロントのオリジンが含まれているか確認（[packages/auth/src/index.ts](../packages/auth/src/index.ts) が `CORS_ORIGIN` をカンマ区切りで読む）。
- **画像が表示されない**: アップロードURLは API origin ベース（`https://api.fesflow.shikosai.net/uploads/...`）。API のカスタムドメインが有効か確認。
- **`/w/:id` が 500**: 対象イベントが存在しない可能性。イベントを1件作成する。

## 未対応 (デプロイ後の課題)

- メール送信は未実装（アプリ内通知のみ）。実送信は Resend + 独自ドメインで将来対応。
- register(イベント管理)から `/api/wristbands/issue` を叩く来場者ID発行UIは未配線。
- 来場者の本命機能（スタンプラリー/整理券/レビュー/抽選）は未実装（スキーマは用意済み）。
- CORS は現状ワイルドカード反射 + credentials。必要ならオリジンを絞る。
