# SaaS 課金設計 (Phase F — Stripe Checkout)

FesFlow の SaaS 化 Phase A〜E(テナントモデル/招待オンボーディング/運営コンソール/
sudo・なりすまし)に続き、2026-11-04 に Stripe Checkout の基本フローを追加した。

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

## Stripe 実装 (2026-11-04)

1. `POST /api/billing/checkout` は Stripe REST API で Checkout Session を作る。カード情報は扱わず、戻り先は `CORS_ORIGIN` から組み立てる。
2. **価格は Stripe Dashboard が正本**。API は `STRIPE_PRICE_EVENT` と任意の段階 Price ID (`STRIPE_PRICE_CIRCLES_2` / `_5` / `_10`) を使い、金額をコードへ固定しない。段階 Price は基本 Price に加算する one-time / JPY Price とする。
3. Webhook は `POST /api/billing/webhook`。Workers WebCrypto の HMAC-SHA256 と300秒の時刻許容差で署名を検証する。`checkout.session.completed` と遅延決済成功イベントを処理し、受信済みIDを `stripe_webhook_event` に記録して重複を防ぐ。
4. 支払い成功時は `event.billingStatus` / `plan` / `maxCircles` / `activatedAt` / `stripeCustomerId` を更新し、`contract_payment` に Stripe 入金を記録する。既存の super_admin 手動有効化は維持する。
5. イベント契約タブにイベント管理者向け Checkout 導線を追加した。

Stripe アカウントと価格が未設定のため、本番・実 Stripe API 接続確認は未実施。設定手順は [DEPLOY.md](DEPLOY.md) を参照する。

## 注意

- 本番 migration は additive(baseline 再生成禁止。既存データ保護)。
- 認証は Google + パスキー一本化済み。決済開始権限はイベント管理者に限定し、決済者の本人性はログインアカウント(ownerEmail)で担保。
