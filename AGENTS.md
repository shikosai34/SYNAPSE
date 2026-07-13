# Agents.md
// テンプレートを以下に貼り付けたので、書き換えること
// 書き換えたらこの指示は消して良い

## Project goal
以下のシステムのモノレポ構成です。
- 文化祭の模擬店向けシステム
  - 注文管理
  - 売上管理
- 来場者向けシステム
  - スタンプラリー
  - 事前注文選択
  - 抽選
- 校内配信の制御システム
  - 配信映像を作成しているOBSに対して信号を送信
  - webUI

## Stack
- Product name: **FesFlow** (`packages/config` の PRODUCT_NAME に集約。名称変更はここだけ編集)
- Frontend: Vite + React 19 + React Router (SPA)。UI は Tailwind v4 + radix/shadcn
- Backend: Hono を Cloudflare Workers 上で実行 (`apps/api`)
- API: REST (Hono routes) + tRPC。認証は better-auth
- Language: TypeScript / Package manager: bun / monorepo: turbo
- Database: Cloudflare D1 (drizzle-orm)。ローカルは wrangler(Miniflare) がエミュレート
- Storage: Cloudflare R2 (`packages/storage` で抽象化、ローカルは MinIO/wrangler)
- Deploy target: Cloudflare Workers (API=Worker, フロント=Workers Static Assets)
- 重要: Worker では db/auth は per-request (AsyncLocalStorage)。`process.env` 直読み禁止、
  env は `getEnv()` / `c.env` 経由。fs/Node サーバ API は使わない。

## Important commands
- Install: `bun install`
- Dev(all): `bun run dev` / 個別: `bun run dev:api`(:8787), `bun run dev:register`(:3000)
- Typecheck: `bun run check-types` (turbo)
- Build: `bun run build` (turbo)
- DB: `bun run db:generate` (スキーマ→SQL), `bun run db:migrate:local` / `:remote` (D1適用)
- Deploy: 各アプリで `bunx wrangler deploy` (or `bun run deploy`)

## Working rules
- 変更前に関連ファイルを読む。
- 既存の設計・命名に合わせる。
- 大きな変更は小さな差分に分ける。
- コードを書き足し、削除したときにはコメントでその理由、思想、選択理由を日付と共にすぐ近くに残しておく。
- 不要な依存関係を追加しない。
- 仕様が曖昧な場合は、最小変更で実装し、仮定をPR本文に書く。
- 機能ごと、作業ごとに日本語でのcommitを残す

## UI rules
- docs/DESIGN.mdに従う。
- アクセシビリティーに配慮する。

## Validation
// TODO 開発開始してpackage.jsonができたら、bunのlintやtestを追加する
変更後は原則として以下を実行する。
1. `...`
2. `...`
3. `...`

## Attention
- 本番環境の設定値を変更しない。
- 自作UIコンポーネントを使わない。
- DBスキーマを勝手に破壊的変更しない。
- 認証・課金・権限周りを推測で変えない。
- generated files を手編集しない。
- 2026-07-13: サークル統計・分析画面 (`/circle/dashboard/analytics`) を追加。左メニュー (`DashboardLayout.tsx` の `circleMenuItems`) とダッシュボードトップ (`Index.tsx` の `rawItems`) の両方に含めていることを維持すること。
- 2026-07-13: イベントおよびサークルそれぞれにデータエクスポート画面を追加した。来場者一覧エクスポート用のAPI `GET /api/festivals/:id/visitors` を追加している。各データエクスポート画面は左メニューおよびダッシュボードトップに正しく含めること。
- 2026-07-13: リストバンド紛失処理を「来場者・リストバンド管理」へ昇格。UIをポップアップモーダルベースに刷新し、ニックネームやアカウント制限を含む全データ編集に対応。スマホ用来場者発行機能も本画面へ統合した。

## Directory map
- `docs`: 設計資料 (`docs/reference` は旧 FesOrder のドメイン資料)
- `apps/api`: バックエンド (Hono Worker, D1+R2, REST+tRPC+better-auth)
- `apps/app`: 模擬店/イベント/システム管理向けアプリ (Vite SPA, :3000)
- `apps/visitor`: 来場者向けアプリ (Vite SPA, :3001)。register とは独立ビルド。
  入場は /w/:id (リストバンドQR) → オンボーディング(ニックネーム+誕生日) → マイページ。
  管理者の権限/ダッシュボードは持たない。VITE_REGISTER_URL で店頭スキャン先を指定。
- `apps/stream`: 校内配信制御アプリ (未着手)
- `packages/config`: ブランド定数 (PRODUCT_NAME) + tsconfig.base
- `packages/db`: drizzle スキーマ + createDb / ALS リクエストストア
- `packages/auth`: better-auth ファクトリ
- `packages/api`: tRPC ルーター (`@fesflow/api`)
- `packages/storage`: R2/MinIO 抽象化
- 移植補助シム: `apps/app/src/components/{link,image,script}.tsx`,
  `apps/app/src/lib/next-navigation.ts` (旧 next/* 互換)

## PR expectations
PRには以下を書く。
- 変更内容
- 背景
- ユーザーからの指示
- 実行した確認
- 影響範囲
- 残タスク
  - issueを立てているか

## about this project

truboを使ってものレポで構成しています。
bunを使っています。
cloudflareにデプロイすることを前提として構築しています。

## コードにコメントとして判断を残すこと

あとからなぜこのような仕様になっているのかを追跡するのがコードだけで完結させることができるので、意志を持って実装をした部分に関してはコメントを残してください。
チーム開発を行なっているので思想がコードに残っている方が都合がいいです。

## デプロイ、ローカル開発時

docs/DEPLOY.md
docs/DEVELOPMENT.md
を参考にしながら行なってください。

## 作業終了時