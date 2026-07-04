# FesFlow (SYNAPSE Monorepo)

文化祭の模擬店・来場者・校内配信を統合管理するシステム **FesFlow** のモノレポ開発リポジトリです。

> 📖 **詳しいドキュメント**
> - ローカル開発の手引き: [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)
> - 本番デプロイ手順: [docs/DEPLOY.md](./docs/DEPLOY.md)
> - デザインシステム: [docs/DESIGN.md](./docs/DESIGN.md)

---

## 🚀 クイックスタート (Getting Started)

### 1. 依存関係のインストール
本プロジェクトはパッケージマネージャーとして `bun` を使用しています。
```bash
bun install
```

### 2. 環境変数のセットアップ
ルートにある環境変数テンプレートからローカル用の環境変数を生成し、各アプリケーションへの紐付けを行います。
```bash
bun run setup:env
```
> [!NOTE]
> このコマンドを実行すると、プロジェクトルートに `.env` が生成されます。また、Cloudflare Worker (`apps/api`) がローカル開発時に環境変数を読み込めるように、`apps/api/.dev.vars` からルートの `.env` へのシンボリックリンクが自動で作成されます。

### 3. ローカルデータベースのマイグレーション適用
ローカルの Cloudflare D1（SQLiteエミュレーター）にスキーマを適用します。
```bash
bun run db:migrate:local
```

### 4. 開発サーバーの起動
すべてのアプリケーションとパッケージの開発サーバーを一括起動します。
```bash
bun run dev
```
- API サーバー (Hono Worker): [http://localhost:8787](http://localhost:8787)
- スタッフ/管理アプリ (register Vite SPA): [http://localhost:3000](http://localhost:3000)
- 来場者アプリ (visitor Vite SPA): [http://localhost:3001](http://localhost:3001)

> [!TIP]
> 新規の空 DB では管理者もイベントも無いため、初回は管理者サインアップとイベント作成が必要です。手順は [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) を参照してください。

---

## 📁 プロジェクト構造 (Directory Map)

リポジトリは Turborepo を用いたモノレポ構成になっており、アプリケーションと共通共有パッケージに分かれています。

```
.
├── apps/                    # アプリケーション層
│   ├── api/                 # バックエンド API (Hono on Cloudflare Workers)
│   ├── register/            # スタッフ/イベント/システム管理アプリ (Vite SPA, :3000)
│   ├── visitor/             # 来場者向けアプリ (入場/オンボ/マイページ) (Vite SPA, :3001)
│   └── stream/              # 校内配信制御アプリ (OBS連携 WebUI) [未着手]
├── packages/                # 共有パッケージ群
│   ├── config/              # プロダクト全体の共通定数・共通 tsconfig
│   ├── db/                  # Drizzle ORM スキーマ定義・ALSリクエストストア
│   ├── auth/                # better-auth インスタンス生成ロジック
│   ├── api/                 # tRPC ルーター定義
│   └── storage/             # Cloudflare R2 / MinIO 抽象化レイヤー
└── docs/                    # 設計資料・ドキュメント類
    ├── DEVELOPMENT.md       # ローカル開発の手引き
    ├── DEPLOY.md            # 本番デプロイ手順 (Cloudflare)
    ├── DESIGN.md            # StudioBlank デザインシステム仕様
    └── 設計メモ.md           # 開発初期のアイデア・設計メモ
```

---

## 🛠 開発コマンド (Commands)

| コマンド | 説明 |
| :--- | :--- |
| `bun run dev` | 全アプリケーションのローカル開発サーバーを起動 (turbo) |
| `bun run dev:api` | API サーバー単体で起動 (ポート `8787`) |
| `bun run dev:register` | スタッフ/管理アプリ単体で起動 (ポート `3000`) |
| `bun run dev:visitor` | 来場者アプリ単体で起動 (ポート `3001`) |
| `bun run build` | 全アプリケーションのビルド (turbo) |
| `bun run check-types` | 全コードの型チェック (turbo) |
| `bun run db:generate` | `packages/db` のスキーマ変更から SQL マイグレーションファイルを生成 |
| `bun run db:migrate:local` | ローカルの D1 エミュレータにマイグレーションを適用 |
| `bun run db:migrate:remote` | 本番環境の Cloudflare D1 にマイグレーションを適用 |
| `bun run db:studio` | Drizzle Studio を起動してデータベースをGUIで確認 |
| `bun run setup:env` | ルートの `.env` 作成および API 向け `.dev.vars` へのシンボリックリンク作成 |

---

## ⚙️ 技術スタック (Tech Stack)

### フロントエンド
- **Vite** + **React 19** + **React Router** (SPA)
- **Tailwind CSS v4** + **Radix UI** / **shadcn/ui**
- デザインシステム仕様: [docs/DESIGN.md](file:///Users/takumi/Develop/Shikosai/SYNAPSE/docs/DESIGN.md)

### バックエンド
- **Hono** running on **Cloudflare Workers**
- API通信: REST (Hono routes) + **tRPC**
- 認証: **better-auth**

### データベース & ストレージ
- Database: **Cloudflare D1** (ORM: **Drizzle ORM**)
- Storage: **Cloudflare R2**（ローカル開発時は MinIO または Wrangler エミュレーターで代用）

---

## ⚠️ 開発時の重要なルール

1. **環境変数の参照方法**
   - Cloudflare Worker の仕様およびリクエストごとのコンテキスト（AsyncLocalStorage）管理のため、サーバーサイドコード内で `process.env` を直接読み込むのは禁止です。
   - 必ず `getEnv()` または Hono の `c.env` 経由で取得してください。
2. **デザインシステムの遵守**
   - UIの作成・変更時は [docs/DESIGN.md](file:///Users/takumi/Develop/Shikosai/SYNAPSE/docs/DESIGN.md) の「StudioBlank Design System」ルールに従ってください（角丸は `0px`、ドロップシャドウなしのフラットデザインなど）。
   - 自作の勝手なUIコンポーネントの追加は避けてください。
3. **Node.js依存 API の制限**
   - Cloudflare Workers 上で動作させるため、Node.js 固有のファイルシステム（`fs` など）やサーバーAPIに直接依存したコードは記述しないでください。

---

## 🌐 本番環境へのデプロイ手順 (Production Deployment)

> 詳細な手順・トラブルシュートは [docs/DEPLOY.md](./docs/DEPLOY.md) を参照。ここは要点のみ。

### ドメイン構成

| 用途 | ドメイン | Worker |
|---|---|---|
| 来場者 / トップ | `fesflow.shikosai.net` | `fesflow-visitor` |
| サークルスタッフ | `staff.fesflow.shikosai.net` | `fesflow-register`(同一) |
| イベント/システム管理 | `admin.fesflow.shikosai.net` | `fesflow-register`(同一) |
| API | `api.fesflow.shikosai.net` | `fesflow-api` |

- register は1つのSPAをロール別にセクション分けし、staff/admin の2ドメインを同一 Worker に割当。
- 認証Cookieは全て `*.shikosai.net` 配下=同一サイトなので、サブドメイン間でセッションを共有できる。
- カスタムドメインは各 `wrangler.jsonc` の `routes` に定義済み（ゾーン `shikosai.net` が
  同一 Cloudflare アカウントにあること）。

### 前提 (初回のみ)

```bash
bunx wrangler login
bunx wrangler r2 bucket create fesflow-uploads
bunx wrangler d1 create fesflow-db     # 表示された database_id を apps/api/wrangler.jsonc に反映
```

### 1. 機密の登録 (secret)

非機密の設定（`BETTER_AUTH_URL` / `CORS_ORIGIN` / `INITIAL_SUPER_ADMIN_EMAIL` / `R2_PUBLIC_URL`）は
[apps/api/wrangler.jsonc](./apps/api/wrangler.jsonc) の `vars` に記載済み。**機密の秘密鍵のみ** secret で登録:

```bash
cd apps/api
bunx wrangler secret put BETTER_AUTH_SECRET   # 32文字以上のランダム文字列
```

### 2. リモート D1 マイグレーション

```bash
bun run db:migrate:remote
```

### 3. ビルド & デプロイ

本番フロントの URL は [.env.production](./.env.production) から `vite build` 時に焼き込まれる。
deploy スクリプトは非対話（`CI=true`）なのでプロンプトで止まらない。

```bash
bun run deploy    # turbo が build 依存込みで api / register / visitor を全デプロイ
```

### 4. 初期セットアップ

1. `admin.fesflow.shikosai.net` で `INITIAL_SUPER_ADMIN_EMAIL` のメールでサインアップ → `super_admin` 自動付与。
2. イベントを1件作成（来場者の `/w/:id` 入場はイベントが1件以上ないと外部キーエラーになる）。
3. 来場者QR `https://fesflow.shikosai.net/w/<id>` → オンボーディング → マイページ を確認。

