# UX 改善メモ（register 管理画面）

最終更新: 2026-07-05

register アプリ（スタッフ/イベント/システム管理）の UI リファクタリングに伴い洗い出した
UX 課題と改善案。**コードを正**とし、実装済みのものと未実装の提案を分けて記載する。
実装対象の優先度は「現場での事故防止 > 操作効率 > 見た目の一貫性」で判断している。

---

## 1. 今回のリファクタで実装済みの改善

| # | 改善 | 内容 | 対象 |
| :-- | :-- | :-- | :-- |
| I-1 | モーダルの Escape 閉じ | キーボードだけで閉じられる | `ui/Modal.tsx` |
| I-2 | 背景スクロールロック | モーダル表示中に背後がスクロールしない | `ui/Modal.tsx` |
| I-3 | `role="dialog"`/`aria-modal` | スクリーンリーダーがダイアログを認識 | `ui/Modal.tsx` |
| I-4 | ラベルと入力の紐付け | `FormField` が `htmlFor`/`id` を強制。ラベルタップで入力にフォーカス | `ui/FormField.tsx` |
| I-5 | 閉じるボタンの `aria-label` | ×ボタンに「閉じる」ラベル | `ui/Modal.tsx` |
| I-6 | 状態色トークンの統一 | 編集バナーの直書き緑(`text-green-600`)を `success` トークンへ | `ui/FormField.tsx` |

> 上記はデザイン/挙動を大きく変えずに入れられた低リスク改善。フォーム系モーダルは
> `Modal` + `FormField` + `useEntityForm` の3点に集約したため、以降の改善は
> **1箇所直せば全モーダルに波及**する。

### 追加対応（2026-07-04 第2弾）

| # | 改善 | 内容 | 対象 |
| :-- | :-- | :-- | :-- |
| I-7 | 枠線の一貫化 | 任意px枠線 **154箇所** を `thin/thick/heavy` トークンに一括変換。太さのバラつきを解消 | register 全体 |
| I-8 | 消えていた区切り線の修復 | `border-b-thick`/`border-t-thick` が未定義でCSS未生成だったバグを修正（方向指定版を `index.css` に追加）。ヘッダー区切り線が復活 | `index.css` |
| I-9 | 枠線トークンの色分離 | トークンを幅のみ定義にし、色指定(`border-primary` 等)との競合を解消 | `index.css` |
| I-10 | native `confirm()` 廃止 | スペース退出・拡張機能アンインストールの確認を `ConfirmDialog` に置換（ブロック回避） | `header.tsx` / `Mods.tsx` |
| I-11 | モーダルの縦スクロール | 画面より高いモーダルは `max-h-[85vh]` でヘッダー固定＋本文スクロール | `ui/Modal.tsx` |
| I-12 | 対応設定モーダルの共通化 | `ToppingMappingModal` を共通 `Modal` に統一（Escape/背景クリック/スクロール継承） | `ToppingMappingModal.tsx` |
| I-13 | 追加系UIのポップアップ化 | インライン展開だった「メンバー追加」「招待リンク作成」「新規イベント作成」を共通 `Modal` + `FormField` に統一 | `Members.tsx` / `Admin.tsx` |
| I-14 | 枠線＝押せるものの合図 | 表示専用カード/情報ボックスの囲み枠を除去。`Card` 既定を枠線なしにし、クリック可能カードは `interactive`。ボタン/入力/区切り線/モーダル枠は維持 | `card.tsx` ほか |

> **メニュー・トッピングの分離**は既に実装済み（DB: `menu` / `topping` / 中間表 `menu_topping`、
> UI: 各独立セクション＋「トッピング対応設定」モーダル）。今回はそのモーダルを共通化した。

### 追加対応（2026-07-05 第3弾: バックログ A/B/C の実装）

| # | 改善 | 内容 | 対象 |
| :-- | :-- | :-- | :-- |
| A-1 | 自動保存の可視性 | `useEntityForm` が `saveStatus`(idle/saving/saved/error) を返し、`EditModeBanner` 右側に「保存中…（スピナー）/ ✓ 保存済み / 保存失敗（再フォーカスアウトで再試行）」を表示 | `useEntityForm.ts` / `FormField.tsx` / 各 FormModal |
| A-2 | 破壊的操作の確認統一 | 確認なしで即実行だったメニュー削除・トッピング削除（`Menu.tsx`）、メンバー除名・招待リンク削除（`Members.tsx`）を `ConfirmDialog` 経由に統一（対象名を明記）。`Members.tsx` の両操作に成功/失敗トーストも追加 | `Menu.tsx` / `Members.tsx` |
| A-3 | 会計スキャン必須のロック理由表示 | 注文確定ボタンのラベルを固定し、無効理由（`[顧客未スキャン]` / `[カートが空です]`）をボタン直上の注意ボックスに列挙表示 | `pages/Register.tsx` |
| B-1 | 空状態の統一 | `ui/EmptyState.tsx` を新設（破線太枠・アイコン・[+ 追加] 直結ボタン）。メニュー/トッピング/スタッフ/メンバー/招待リンク/サークル/イベントスタッフ/イベント一覧の 0 件表示を統一 | `EmptyState.tsx` ほか 7 画面 |
| B-2 | ローディングの一貫性 | テキストのみのローディングをカード形状に合わせた `Skeleton` グリッドへ置換（CirclesTab / StaffTab / Admin / Menu） | 各一覧画面 |
| B-3 | 数値入力の共通ガード | `FormField` の `type="number"` で `min=0`・`inputMode="numeric"` を既定化し、onBlur 時に min でクランプ＋先頭 0 正規化（ネイティブ setter + input イベント再発火で呼び出し側 state を壊さない） | `ui/FormField.tsx` |
| B-4 | フォーカストラップ | `hooks/useFocusTrap.ts` を新設し `Modal`/`ConfirmDialog`/`ConfirmationDialog` に適用。モジュールレベルのスタックで**最前面のダイアログのみ** Tab/Escape を処理（多重ダイアログの競合を防止）。Escape 処理も3コンポーネントの重複実装からフックへ一本化。`ConfirmationDialog` に不足していた `role="dialog"`/`aria-modal`/Escape/背景クリック閉じも追加 | `useFocusTrap.ts` / ダイアログ3種 |
| C-1 | ロール表示ラベルの統一 | `lib/roles.ts` を新設（`ROLE_LABELS`/`ROLE_BADGES`/`roleLabel()`/`roleBadge()`、未知ロールは大文字化フォールバック）。`header.tsx` の重複マップ・switch 文 2 箇所を置換。`useCircleAuth.tsx` の ROLES 定数は権限ロジック用のため対象外 | `lib/roles.ts` / `header.tsx` |

---

## 2. 未実装の提案（要判断）

### C. 一貫性・情報設計（優先度: 中〜低）

- **C-2 スペース切り替え/アカウントの導線**: ヘッダーの
  「[通知][スペース名 権限][アカウント]」構成（コミット履歴で整備中）の
  一貫性を全ロールで確認。
- **C-3 レスポンシブ**: POS/スキャンはモバイル・タブレット最適化済み。
  管理系テーブルの横スクロール/折返しを狭幅で再確認。

---

## 3. ドキュメント側の残タスク

- `docs/reference/仕様書.md` は旧 FesOrder（`apps/web`/`apps/server`・旧ロール）前提のまま。
  現 FesFlow 構成・新ロール体系へ更新するか、明示的に「旧資料」と注記する。
- `docs/reference/DESIGN.md` は StudioBlank テンプレートのまま（正典は `docs/DESIGN.md`）。
  参照されていないため、削除または `docs/DESIGN.md` への誘導スタブ化を検討。
