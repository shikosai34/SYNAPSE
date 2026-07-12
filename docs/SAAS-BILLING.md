# SaaS 課金設計 (Phase F — 未実装・予約)

FesFlow の SaaS 化 Phase A〜E(テナントモデル/招待オンボーディング/運営コンソール/
sudo・なりすまし)は実装済み。本書は **後続フェーズの Stripe 決済**の設計メモ。
現状はカラム予約 + 手動有効化のみで、決済コードは未実装。

## 現状(実装済みの土台)

- `event` テーブル(`packages/db/src/schema/core.ts`)に予約済み:
  `plan` / `billingStatus`(active|trial|suspended|unpaid)/ `maxCircles` /
  `ownerEmail` / `stripeCustomerId` / `stripeSubscriptionId` / `activatedAt` / `suspendedAt`。
- 無料枠: イベント自己作成で `plan=free, maxCircles=1, billingStatus=active`。
- 手動有効化: super_admin が `PATCH /api/admin/events/:id`(system.ts adminRoutes)で
  plan/maxCircles/billingStatus を書き換え(= 銀行振込・請求書払いの運用に対応)。
- サークル上限: `POST /api/circles` が `maxCircles` 超過を 403 で拒否。
  `billingStatus=suspended` は新規作成を拒否。

## 課金モデル(推奨: イベント単位のワンタイム + 段階課金)

学園祭/同人即売会は単発イベントが主なので、月額サブスクは相性が悪い(オフシーズンで解約)。
- **基本ライセンス**: イベント1件あたりの単発課金(one-time)。
- **サークル枠の追加**: `maxCircles` を段階課金で拡張。
- **銀行振込**: super_admin の手動有効化(実装済み)でカード必須を回避。

## 実装予定(Stripe)

1. `stripe` npm パッケージ(Workers 上で動作)。秘密鍵は `wrangler secret put STRIPE_SECRET_KEY`。
2. **`POST /api/billing/checkout`**: Hono で Stripe Checkout セッションを作成し
   `success_url`/`cancel_url` を返す。自前カードフォームを持たず PCI-DSS 準拠を容易にする。
   `stripeCustomerId` を event に保存。
3. **`POST /api/billing/webhook`**: `STRIPE_WEBHOOK_SECRET` で署名検証 →
   `checkout.session.completed` 等で `event.billingStatus`/`plan`/`maxCircles` を更新。
   冪等性のため処理済みイベントIDを記録。
4. フロント: 運営コンソール Billing タブに Stripe 導線 + プラン別集計(overview は実装済み)。
5. プロモコード/100%割引: Stripe Coupon か、既存の手動有効化を継続利用。

## 注意

- 本番 migration は additive(baseline 再生成禁止。既存データ保護)。
- 認証は Google + パスキー一本化済み。決済者の本人性はログインアカウント(ownerEmail)で担保。
