# FesFlow 商品化棚卸し（ドラフト）

- 作成日: 2026-11-04
- 目的: 後期中間試験後の FesFlow ローンチ（他校・他イベントへの有償導入）に向けた準備の第一歩として、現状を棚卸しする。
- 調査対象: ローカルクローン `~/workspace/repos/SYNAPSE` のチェックアウト（コミット `72834c8`、PR #192 マージ時点）のコードとドキュメント。読み取りのみで、リポジトリへの変更はしていない。
- 注意: 本番（main）にはこのチェックアウト以降に PR #193（リストバンドなし注文の許可設定）と PR #194（ダッシュボード左ナビ追従）がマージ済みであり、本書の機能一覧には含まれていない。リストバンドなし注文設定は本番反映済みの機能として別途数えること。
- 表記ルール: コードやドキュメントで確認したことは「事実」、確認できないことは「未確認」、筆者の見立ては「推測」と明記する。

## 0. 要点

- 事実: FesFlow は単一テナント前提の専用システムではなく、**複数イベントを 1 つのデプロイで扱うマルチテナント SaaS の土台が既に実装されている**（テナントモデル、招待オンボーディング、運営コンソール、プラン・上限管理、手動有効化）。根拠は `docs/SAAS-BILLING.md` と `packages/db/src/schema/core.ts` の課金カラム、`apps/api/src/routes/system.ts` の管理ルート群。
- 事実: 一方で、動く場所は **佐藤の Cloudflare アカウント（Shikosai）と `fesflow.shikosai.net` ドメインに固定** されている。ドメインは `apps/api/wrangler.jsonc`、`.env.production`、`packages/auth` の trustedOrigins、API のホスト判定に直接書かれている。
- 事実: 料金徴収は「手動有効化（銀行振込・請求書払い前提）」まで実装済みで、**Stripe 等のオンライン決済は未実装**（設計メモのみ）。
- 事実: 利用規約・プライバシーポリシーの実物、導入先向け手順書、サポート体制、本番負荷試験は未整備。法務リスク分析（`docs/legal_risk_analysis.md`）と SaaS 公開前監査（`docs/SAAS-READINESS-AUDIT.md`）は既に存在するが、一部は古い。
- 権利関係（所有者の判断、2026-11-04）: FesFlow は基本的に個人のプロジェクトであり、学校側のスタンスも「個人が作ったものを文化祭で使ってみた」という位置づけのため、外部への有償提供に問題はないと所有者は判断している（学校からの正式な確認文書があるわけではない）。コミットの約90%は佐藤本人で、共同制作者と一緒にローンチする方針。残る事項は、共同制作者との役割分担・収益配分の取り決めと、導入先向けの個人情報の取り扱い説明の整備である。

## 1. 現在の機能一覧（事実ベース）

構成: フロントは単一 SPA（`apps/app`、来場者・サークル・イベント管理・システム管理をパスで分離）、API は Hono on Cloudflare Workers（`apps/api`）、DB は Cloudflare D1、ファイルは R2、認証は better-auth（Google OAuth とパスキーに一本化済み）。

### 1.1 来場者向け

- 入場導線: QR コード（`/w/:id`）からのオンボーディング（ニックネーム等の登録、データ利用に関する案内表示あり）、マイページ、アカウント管理（`apps/app/src/pages/Entry.tsx`, `Onboarding.tsx`, `MyPage.tsx`, `VisitorAccount.tsx`）
- メニュー閲覧と事前注文（pre-order）: イベント／サークル別メニュー、事前注文の作成・状態確認（`apps/api/src/routes/pre_order.ts`、来場者の注文履歴ページ `Orders.tsx`）
- モバイルオーダー: サークルの QR から注文する導線（サークル側「モバイルオーダーQR」）
- スタンプラリー: スタンプ取得・進捗確認、景品交換（`routes/stamp.ts`、イベント側の「景品交換受付」）
- 抽選: スタンプ等の口数に応じた抽選（`routes/lottery.ts`、イベント管理に「抽選」タブ。拡張機能として有効化時のみ表示）
- クーポン・割引: クーポン引き換えページ（`/visitor/coupon/:slug`）、割引適用（`routes/coupon.ts`, `discount.ts`）
- レビュー: 来場者レビューの投稿・閲覧（`routes/review.ts`、`VisitorReviews.tsx`）
- 通知: お知らせ表示と Web Push 通知（`routes/notification.ts`、`apps/api/src/services/web-push.ts`、PWA 対応は `docs/PWA.md`）
- リストバンド連携: リストバンド ID と来場者アカウントの紐付け、紛失時の再発行導線（運営側処理）

### 1.2 サークル（模擬店）向け

- レジ（POS）: 店頭注文の受付・会計、注文番号表示、客向け表示（カスタマーディスプレイ）（`pages/Register.tsx`, `OrderNumberDisplay.tsx`, `RegisterCustomerDisplay.tsx`、注文確定は `apps/api/src/services/order-commit.ts` で原子化）
- 注文運用: バックヤード画面（調理・受け渡し側）、注文状態の更新（`pages/Backyard.tsx`）
- 商品・在庫: メニュー管理（トッピング含む）、在庫管理・売り切れ制御（`pages/dashboard/Menu.tsx`, `Stock.tsx`、`routes/menu.ts`, `topping.ts`）
- 売上・分析: 売上管理、統計・分析、レビュー確認、データエクスポート（CSV 等）（`pages/dashboard/Sales.tsx`, `Analytics.tsx`, `Export.tsx`）
- 販促: クーポン管理、割引管理（セット割引等）（`pages/dashboard/Coupons.tsx`, `Discounts.tsx`）
- 組織管理: メンバー管理・招待、スタッフ管理（拡張機能）、権限管理（ロールと permission の粒度は `docs/AUTHORIZATION.md` と API の認可チェック）
- サークル設定: 営業設定（事前注文可否、注文フロー等は `circle.settings` JSON）、拡張機能（mod）の管理。mod は iframe サンドボックス実行で CSP 制限付き
- セットアップ: サークル作成ウィザード（`components/circle/CircleCreateWizard.tsx`）

### 1.3 イベント運営向け

- イベント作成ウィザードとイベント設定（`components/event/EventCreateWizard.tsx`、設定タブ。支払い方法はイベント単位で設定可能で既定は「現金」、`packages/db/src/schema/core.ts` の `paymentMethods`）
- 当日運営: 混雑モニター、開催中の混雑・人員配置、注文モニタ、在庫・売り切れの一覧、一斉アナウンス（`components/event/` 配下の各タブ）
- リストバンド管理: バンド発行・一括発行履歴、来場者記録の編集、紛失バンド交換、来場者情報の削除（`WristbandsTab.tsx` 等）
- スタンプラリー運営: ラリー設定、景品交換受付、利用状況ダッシュボード
- 会計・集計: 全体売上管理、精算、日次締め、イベント全体レポート、データエクスポート（来場者一覧エクスポート API 含む）
- 組織管理: サークル管理（作成リンク発行・設定マトリクス）、店舗エリア管理、スタッフ管理、共同管理者の招待
- 契約状況タブ: 自イベントのプラン・契約状態の確認（`ContractTab.tsx`）
- 開催ライフサイクル: 終了／アーカイブ後は配下が閲覧のみモードになる制御あり

### 1.4 プラットフォーム運営（佐藤側）向け

- 運営コンソール（`/sys`）: 全イベント一覧と集計（overview）、イベント／課金の管理（プラン・サークル上限・課金状態の変更、停止、削除、復旧）、アカウント管理、お知らせ管理、監査ログ、メンテナンス設定（`routes/system.ts` の `adminRoutes`、sudo 昇格と「なりすまし」セッションによるサポート対応の仕組みあり）
- テナント管理の前提機能: イベントの自己作成（無料枠: `plan=free`, `maxCircles=1`）、上限超過の拒否（`POST /api/circles` が 403）、`billingStatus=suspended` での新規作成停止
- データ保持: 終了イベントの自動削除ジョブ（保持期間の既定 365 日、30〜3,650 日で変更可能）。ただし本番では `CLEANUP_ENABLED` 未設定で dry-run のまま（後述）

### 1.5 未実装・部分実装（事実）

- 校内配信の制御システム（OBS 連携）: `apps/stream` は未着手で、このチェックアウトにはディレクトリ自体が存在しない（`AGENTS.md` の Directory map には記載あり）。
- オンライン決済（Stripe）: 未実装。カラム予約と設計メモのみ（次節）。
- 整理券（numbered ticket）: スキーマ定義と一部コード参照はあるが、来場者向け導線として完成しているかは未確認。
- スタンプ景品の必要数: 定数 `REQUIRED_STAMP_COUNT` で固定されており、イベント単位の設定化は未了（`docs/SAAS-READINESS-AUDIT.md` の L-1）。

## 2. 製品として提供できるものの範囲（導入形態の現状）

### 2.1 現在の導入形態（事実）

- 稼働基盤は 1 つの Cloudflare アカウント（`apps/api/wrangler.jsonc` に `account_id` 固定）に、API Worker 1 つ、SPA 1 つ、D1 データベース 1 つ（`fesflow-db`）、R2 バケット 1 つ（`fesflow-uploads`）を置く構成。全イベント（テナント）がこの単一 D1 を `event_id` で分けて共有する。
- ドメインは `fesflow.shikosai.net` 単一ドメイン＋パス分離（来場者 `/`、サークル `/circle/*`、イベント管理 `/event/*`、システム管理 `/sys/*`、API `/api/*`）。このドメインは wrangler の routes、`BETTER_AUTH_URL`、`.env.production` の `VITE_*_URL`（ビルド時に焼き込み）、認証の trustedOrigins、API のホスト判定コードに直接依存している。テナントごとの独自ドメインには対応していない。
- 製品名は `packages/config` の `PRODUCT_NAME` に集約されており、名称変更は 1 箇所で済む設計。
- 茨香祭固有の文言はアプリ／API のソース内には確認できなかった（ヒットするのはドメイン名のみ）。ただしイベント初期データや本番 DB の中身は調査対象外であり、未確認。

### 2.2 課金の現状（事実）

- `event` テーブルに `plan` / `billingStatus`（active|trial|suspended|unpaid）/ `maxCircles` / `ownerEmail` / `stripeCustomerId` / `stripeSubscriptionId` / `activatedAt` / `suspendedAt` が実装済み。
- super_admin が運営コンソールから plan・上限・課金状態を手動で書き換える「手動有効化」が実装済みで、`docs/SAAS-BILLING.md` はこれを銀行振込・請求書払い運用に対応するものと位置づけている。
- Stripe の Checkout／Webhook は未実装（同ドキュメントに実装手順の設計のみ）。推奨モデルとして「イベント単位のワンタイム課金＋サークル枠の段階課金」が提示されているが、価格自体は未決定（所有者判断事項）。

### 2.3 提供形態の選択肢（推測・検討材料）

- 形態A（佐藤の基盤でホスティングする SaaS 型）: 現行コードが最も近い形。導入先はアカウントを作ってイベントを作成するだけ
...[truncated 6535 chars]