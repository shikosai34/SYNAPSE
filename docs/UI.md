# shadcn/ui 採用メモ

最終更新: 2026-07-07（Phase6: shadcn/ui の正式採用 + UX 堅牢化）

> デザインシステムそのもの（トークン/配色/タイポグラフィ）は [`DESIGN.md`](./DESIGN.md) を参照。
> 本書は「shadcn の仕組みをどう導入したか」「今後 `bunx shadcn add` する際の注意点」に限定する。

## 背景

register/visitor の `src/components/ui/*` は Phase4 までの間に手書きで実装されてきたが、
実体は既に shadcn の標準構造（`cva` variants, `data-slot`, `cn` によるクラス合成）に
準拠していた。「shadcn を使っている」ことを明示し、今後 `bunx shadcn add <component>` で
新規コンポーネントを追加できるようにするため、各アプリに `components.json` を追加して
正式に shadcn プロジェクトとして登録した。

**既存コンポーネントの見た目・実装は変更していない。** 太枠(border-thick)・角なし
(radius:0)・mono フォント・大文字といった RawBlock テーマ（`DESIGN.md`）はそのまま。

## components.json

`apps/register/components.json` と `apps/visitor/components.json` に同一方針で追加:

- `style: "new-york"` — 見た目には影響しない（shadcn CLI が新規生成する際のベースパターン選択にのみ影響。既存ファイルは上書きしていない）。
- `tailwind.cssVariables: true` — 両アプリとも `index.css` の `@theme` / `:root` / `.dark` で色を CSS 変数化済みのため実態に合わせた。
- `tailwind.css: "src/index.css"` — 実際のテーマ定義ファイルを指す。
- `tailwind.config: ""` — Tailwind v4 は CSS ベース設定 (`@import "tailwindcss"` + `@theme`) で `tailwind.config.js` を持たないため空文字。
- `aliases` — 既存の `tsconfig.json` / `vite.config.ts` の `@/*` → `./src/*` エイリアスに合わせて `@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks` を設定。
- `iconLibrary: "lucide"` — 既に `lucide-react` を全面採用済み。

### 注意: `bunx shadcn add` を使うときの注意点

- **`src/lib/utils.ts` を上書きさせないこと。** shadcn CLI は `init`/`add` 時に `utils.ts` を
  標準の `cn`（tailwind-merge の素の `twMerge`）で上書きしようとすることがある。本プロジェクトの
  `cn` は `@fesflow/config/cn` からの re-export で、border-thin/thick/heavy を
  tailwind-merge の border-width グループに登録する重要な差分を持つ（下記「cn の共有化」参照）。
  CLI が `utils.ts` を書き換えた場合は必ず diff を確認し、re-export 1行に戻すこと。
- 新規コンポーネントを追加した場合、生成された className が RawBlock テーマの慣習
  （`border-thick`/`rounded-none`/`font-mono`/uppercase 等）から外れていないか確認し、
  必要なら手動で寄せる。shadcn デフォルトは角丸・shadow 前提のため、そのままでは
  テーマ崩壊する。

## cn (tailwind-merge 拡張) の共有化

`cn` の実装（clsx + `extendTailwindMerge` で border-thin/thick/heavy を border-width
グループとして登録するもの）は register/visitor で完全に重複しており、
「`border-thick border-border` で幅クラスが色クラスに潰される」バグの修正を
過去に2回別々に行った経緯がある。

- 実体を `packages/config/src/cn.ts` に集約し、`@fesflow/config/cn` として export（`package.json` の `exports."./cn"` に追加、`dependencies` に `clsx`/`tailwind-merge` を追加）。
- 各アプリの `src/lib/utils.ts` は `export { cn } from "@fesflow/config/cn";` の re-export のみに変更。
  `@/lib/utils` からの既存 import はそのまま壊さずに動く。
- `extractIdFromCode`（register 固有）等アプリ固有のユーティリティは今まで通り各アプリの
  `lib/utils.ts` に残している。
- `cn` は React 非依存の純粋関数（clsx + tailwind-merge のみに依存）のため、
  `@fesflow/config` に置いても各アプリの Tailwind v4 コンテンツ走査（`index.css` が
  対象にするソースディレクトリ）には影響しない。

## エラー/空/ローディングの3点セット

Phase4 で導入した型付き `ApiError`（`lib/api-error.ts`）を画面に接続するための
共通コンポーネント。

- **`components/ui/Skeleton.tsx`**: 既存（register/visitor 双方にあり）。
- **`components/ui/EmptyState.tsx`**: register に既存。**今回 visitor にも新設**（register 版と同一 API: `icon`/`message`/`actionLabel`/`onAction`）。
- **`components/ui/ErrorState.tsx`**: **今回新設**（register/visitor 両方）。`ApiError` を
  受け取り、メッセージ・requestId（あれば）・再試行ボタン(`onRetry`)を表示する。
  React Query の `isError` 分岐で `<ErrorState error={error} onRetry={() => refetch()} />`
  を差し込むだけで使える。

## ルート ErrorBoundary

`components/ErrorBoundary.tsx`（register/visitor 両方、同一実装）。React のレンダリング
例外は React Query の `onError` 基盤とは別レイヤーの問題で、捕まえないと SPA 全体が
白画面になる。素の class component（`getDerivedStateFromError`/`componentDidCatch`）で実装し、
`App.tsx` のルートツリー全体（`Providers` の外側）を包む。フォールバックは
「エラーが発生しました」+ 再読み込みボタンを RawBlock テーマで表示するのみ（サーバへの
エラー送信等は今回のスコープ外）。react-error-boundary 等の新規依存は追加していない。
