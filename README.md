# FesFlow (SYNAPSE Monorepo)

文化祭の模擬店・来場者・校内配信を統合管理するシステム **FesFlow** のモノレポ開発リポジトリです。

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
- 模擬店向けアプリ (register Vite SPA): [http://localhost:3000](http://localhost:3000)

---

## 📁 プロジェクト構造 (Directory Map)

リポジトリは Turborepo を用いたモノレポ構成になっており、アプリケーションと共通共有パッケージに分かれています。

```
.
├── apps/                    # アプリケーション層
│   ├── api/                 # バックエンド API (Hono on Cloudflare Workers)
│   ├── register/            # 模擬店向け注文・売上管理アプリ (Vite SPA)
│   ├── visitor/             # 来場者向けアプリ (スタンプラリー/事前注文/抽選) [未着手]
│   └── stream/              # 校内配信制御アプリ (OBS連携 WebUI) [未着手]
├── packages/                # 共有パッケージ群
│   ├── config/              # プロダクト全体の共通定数・共通 tsconfig
│   ├── db/                  # Drizzle ORM スキーマ定義・ALSリクエストストア
│   ├── auth/                # better-auth インスタンス生成ロジック
│   ├── api/                 # tRPC ルーター定義
│   └── storage/             # Cloudflare R2 / MinIO 抽象化レイヤー
└── docs/                    # 設計資料・ドキュメント類
    ├── DESIGN.md            # StudioBlank デザインシステム仕様
    └── 設計メモ.md           # 開発初期のアイデア・設計メモ
```

---

## 🛠 開発コマンド (Commands)

| コマンド | 説明 |
| :--- | :--- |
| `bun run dev` | 全アプリケーションのローカル開発サーバーを起動 (turbo) |
| `bun run dev:api` | API サーバー単体で起動 (ポート `8787`) |
| `bun run dev:register` | 模擬店向けアプリ単体で起動 (ポート `3000`) |
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

### 1. ローカル動作時と本番環境での認証情報の違い
- **ローカル開発時:** D1（SQLite）および R2（ローカルストレージ）は Wrangler がローカルマシン上でエミュレート（Miniflare）するため、**Cloudflare の認証情報は一切不要**です。オフラインで動作します。
- **本番デプロイ時:** Cloudflare 上に実際のリソースをプロビジョニングし、デプロイを実行するために **Wrangler によるログイン認証** が必要になります。

### 2. リソースのプロビジョニング（初回のみ）
Cloudflare アカウント上にデータベースとストレージを作成します。

1. **Wrangler で Cloudflare にログインします**
   ```bash
   bunx wrangler login
   ```
2. **R2 バケットを作成します**
   ```bash
   bunx wrangler r2 bucket create fesflow-uploads
   ```
3. **D1 データベースを作成します**
   ```bash
   bunx wrangler d1 create fesflow-db
   ```
   ※ コマンド実行後にコンソールに表示される `database_id` (UUID形式) をコピーします。
4. **`wrangler.jsonc` の更新**
   [apps/api/wrangler.jsonc](file:///Users/takumi/Develop/Shikosai/SYNAPSE/apps/api/wrangler.jsonc) の `database_id` を、コピーした UUID に書き換えます。
   ```json
   "database_id": "ここにコピーしたUUIDをペースト"
   ```

### 3. 本番用環境変数の設定
本番環境のドメイン情報や認証キーを Cloudflare に登録します。

**機密・環境個別変数の登録 (Wrangler Secret)**
セキュリティに関わるキーや、デプロイ先固有のドメイン設定を登録します。
```bash
# 1. 認証用のセッション秘密鍵（32文字以上のランダムな文字列）
bunx wrangler secret put BETTER_AUTH_SECRET --name fesflow-api

# 2. 本番環境の API Worker URL (例: https://fesflow-api.<your-subdomain>.workers.dev)
bunx wrangler secret put BETTER_AUTH_URL --name fesflow-api

# 3. 本番環境のフロントエンドのオリジン URL (例: https://fesflow-register.<your-subdomain>.workers.dev)
bunx wrangler secret put CORS_ORIGIN --name fesflow-api

# 4. 初期管理者アカウントのメールアドレス
bunx wrangler secret put INITIAL_SUPER_ADMIN_EMAIL --name fesflow-api
```
*(コマンド実行後、プロンプトに従ってそれぞれの実際の値を入力してください)*

### 4. マイグレーションの適用
作成した Cloudflare 上の D1 データベースに対して、最新のテーブル構造スキーマを反映します。
```bash
bun run db:migrate:remote
```

### 5. デプロイの実行
モノレポ全体のビルドとデプロイを実行します。
```bash
bun run deploy
```
※ `turbo deploy` が走り、`apps/api` (Hono API Worker) と `apps/register` (Vite SPA served via Cloudflare Workers Static Assets) がビルドされ、Cloudflare に同時にデプロイされます。

