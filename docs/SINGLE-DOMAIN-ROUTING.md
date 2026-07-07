# 設計案: 単一ドメイン + パス分割ルーティング

> ステータス: **アプリ/設定コードは実装済み (2026-07-07)**。残るは Cloudflare 側の
> DNS/route 反映と本番検証 (このリポジトリ内では完結しない)。
> 現行のサブドメイン構成 (`staff.` / `admin.` / `api.fesflow.shikosai.net`) を、
> **1ドメイン `fesflow.shikosai.net` のパス分割**へ作り直した。
>
> **実装上の方針変更 (当初案からの差分)**: register の router は当初案の「動的 basename」ではなく
> **basename 無し (絶対パス)** を採用した。`/circle/...` `/event/...` `/sys/...` を router がそのまま
> マッチするため、既存の多数のダッシュボードリンク (`/circle/dashboard/*` 等) を無改修で流用でき、
> `/dashboard` がスペースごとに別画面である曖昧さも避けられるため。asset は当初案どおり固定
> プレフィックス `/console/` に隔離 (Vite `base=/console/` + `outDir=dist/console` + build 後に
> `index.html` を dist 直下へコピー)。共有入口 (`/login` `/circle-login` `/checkin` `/invite/:token`)
> は各スペース配下 (`/circle/login` `/event/login` `/sys/login` `/circle/checkin` `/circle/invite/:token`)
> へ移設し、旧トップレベルパスは後方互換リダイレクトを残した。システム管理は `/admin` → `/sys` に改名。

---

## 1. ゴールとパス割り当て (確定)

ドメインは `fesflow.shikosai.net` の1本に統一し、以下のパスで振り分ける。

| パス | 役割 | 提供アプリ |
| --- | --- | --- |
| `/` | 来場者 (スタンプ/事前注文/マイページ 等) | `apps/visitor` |
| `/circle/*` | サークル(スタッフ)コンソール。**レジ = `/circle/register`** | `apps/register` |
| `/event/*` | イベント管理コンソール | `apps/register` |
| `/sys/*` | システム管理コンソール | `apps/register` |
| `/api/*` | バックエンド API (+ 認証 `/api/auth/*`) | `apps/api` |
| `/api/uploads/*` | R2/MinIO 配信 (画像・フォント) | `apps/api` |

要点: **`apps/register` は3つのスペース (circle / event / sys) を1つのSPAで兼ねる**。
これが設計上の最大の論点(後述 §4)。

---

## 2. 現行アーキテクチャ (作り直す対象)

- **3つの Worker**、それぞれホスト単位の `custom_domain`:
  - `fesflow-api` → `api.fesflow.shikosai.net`
  - `fesflow-register` → `staff.` + `admin.fesflow.shikosai.net` (2ホスト)
  - `fesflow-visitor` → `fesflow.shikosai.net` (apex)
- **アプリ間リンクは絶対URL env** (`VITE_API_URL` / `VITE_VISITOR_URL` / `VITE_STAFF_URL` / `VITE_ADMIN_URL`)。
- **スペース切替** (`header.tsx`): 同一オリジンなら `navigate()`、別オリジンなら
  `?_sw=base64(authInfo)` を付けて full redirect し遷移先 `main.tsx` で復元。
- **CORS**: `CORS_ORIGIN` に3オリジン。**better-auth** の `trustedOrigins` は
  apex + `*.fesflow.shikosai.net` ワイルドカード。
- **認証Cookie**: api (`api.fesflow`) が発行し、フロント各サブドメインから
  `credentials: include` + CORS でクロスサブドメイン利用。
- **API 構造は好都合**: 全ルートが既に `/api/*` 配下 (`/api/festivals` 等)、認証も `/api/auth/*`、
  ファイル配信のみ `/uploads/*`。→ 単一ドメインの `/api` へほぼそのまま載る。
- **register の内部ルート** (`App.tsx`) は既にスペース接頭辞を持つ:
  - `/circle/register`(レジ), `/circle/backyard`, `/circle/dashboard/*`
  - `/event/dashboard`
  - `/admin/dashboard` ← **これを `/sys` へ改名**
  - 共有: `/`(Home), `/login`, `/circle-login`, `/checkin`, `/invite/:token`

---

## 3. Cloudflare ルーティング方式の選択肢

### 方式A: Workers Routes をパスパターンに変更 (Worker は3本のまま) — 推奨
各 Worker の `custom_domain` を廃止し、**同一ゾーンのパスパターン route** に置き換える。

```jsonc
// api
"routes": [{ "pattern": "fesflow.shikosai.net/api/*", "zone_name": "shikosai.net" }]
// register (3スペース分)
"routes": [
  { "pattern": "fesflow.shikosai.net/circle/*", "zone_name": "shikosai.net" },
  { "pattern": "fesflow.shikosai.net/event/*",  "zone_name": "shikosai.net" },
  { "pattern": "fesflow.shikosai.net/sys/*",    "zone_name": "shikosai.net" }
]
// visitor (フォールバック)
"routes": [{ "pattern": "fesflow.shikosai.net/*", "zone_name": "shikosai.net" }]
```

- Cloudflare は**より具体的な route を優先**するため、`/api` `/circle` `/event` `/sys` が
  visitor の `/*` より先に一致する。
- 注意: `custom_domain: true` は「ホスト丸ごと」用。**パス単位は `zone_name` 付き route パターン**を使う
  (両者は排他)。apex にプロキシ(オレンジクラウド)された DNS レコードが必要。
- 長所: 新規 Worker 不要・現行3ビルドをほぼ流用。短所: プレフィックス除去の細工ができない
  (各アプリが自分のプレフィックスを前提に作る必要 → §4/§5 で吸収)。

### 方式B: ゲートウェイ Worker + Service Bindings
`fesflow.shikosai.net/*` に薄い**振り分け Worker** を1本置き、パス接頭辞で
api/register/visitor Worker (=内部, 公開ルート無し) へ **service binding** で委譲。

- 長所: プレフィックス除去/書き換え・CSP・ヘッダを一元管理でき最も柔軟。
- 短所: Worker 1本増、1ホップ増 (同一コロなので実測影響は小)。
- 方式Aで asset base やルート優先度に問題が出た場合の**逃げ道**として保持。

> 推奨は **方式A**。§4 の asset 問題を「固定 asset プレフィックス」で解けるため、
> ゲートウェイ無しで成立する。

---

## 4. 最大の論点: register は3スペース兼用の単一SPA

1つの Vite ビルドが持てる `base` は1つだけ。しかし register は `/circle` `/event` `/sys`
の3プレフィックスで配信される。素朴に `base:"/circle/"` にすると `/event` `/sys` で asset が壊れる。

### 解法: 「asset は固定プレフィックス」+「router basename は実行時に決定」
- **Vite `base` を固定の専用プレフィックスにする**。例: `base: "/console/"`。
  → JS/CSS は常に `/console/assets/...` の**絶対パス**で解決され、ページが
  `/circle/...` でも `/event/...` でも `/sys/...` でも壊れない。
  (`/console/*` も register Worker の route に追加して asset を配信する。)
- **React Router の `basename` を起動時に window.location から算出**する:
  ```ts
  const prefix = ["/circle", "/event", "/sys"].find((p) =>
    location.pathname === p || location.pathname.startsWith(p + "/")
  ) ?? "/circle";
  <BrowserRouter basename={prefix}> ...
  ```
  これで **1ビルドが3プレフィックスを兼ねられる**。
- SPA ディープリンク対応: register Worker の assets 設定を
  **`not_found_handling: "single-page-application"`** にし、`/circle/*` `/event/*` `/sys/*`
  は index.html を返す。`/console/*` は静的ファイルを返す。

### register 内部ルートの整理 (basename 前提)
`basename` を各スペースに固定するので、**アプリ内ルートからスペース接頭辞を外す**再編が要る:
- 現 `/circle/dashboard/menu` → basename=`/circle` + ルート `/dashboard/menu`
- 現 `/circle/register`(レジ) → **`/regi`** に改名 (公開URL `/circle/register`)
- 現 `/event/dashboard` → basename=`/event` + ルート `/dashboard`
- 現 `/admin/dashboard` → basename=`/sys` + ルート `/dashboard`
- **共有ルートの移設**: `/login` `/circle-login` `/checkin` `/invite/:token` `/`(Home) は
  今のままだと visitor の `/` と衝突する。各スペース配下へ移す (例: `/circle/login`,
  `/event/login`, `/sys/login`、招待は `/circle/invite/:token` 等)。
  → ログイン後の遷移先・リンク・リダイレクト (`Navigate to`) も一括修正。

---

## 5. 影響範囲と必要変更 (チェックリスト)

1. **wrangler.jsonc ×3**: `custom_domain` → パスパターン route (方式A)。register は
   `/circle` `/event` `/sys` `/console` の4パターン。
2. **Vite 設定**: register `base:"/console/"`、visitor `base:"/"`。api は asset 無し。
3. **React Router**: register に動的 `basename`。内部ルートからスペース接頭辞を除去し再編 (§4)。
4. **env / アプリ間URL**: 絶対URL群を**同一オリジンの相対パス**へ。
   - `VITE_API_URL` → `""`(空)。`fetchApi` は `${base}/api/...` なので空文字で `/api/...` になる。
     ※既定フォールバック `http://localhost:8787` はローカル用に別途手当て (§7)。
   - `VITE_VISITOR_URL` → `/`、`VITE_STAFF_URL`→`/circle`、`VITE_ADMIN_URL`→`/event` `/sys` へ再定義
     (名称も `VITE_CIRCLE_BASE` 等へ改名検討)。
5. **スペース切替 (`header.tsx`)**: 3スペースとも**同一オリジン**になるため
   `?_sw=` クロスドメイン持越しは**不要**。単純に `window.location.assign("/event/...")` /
   `navigate` で済む。`_sw` の生成/復元コード (main.tsx) は撤去可 (Cookie は元々 api 共有)。
6. **CORS**: フロント↔API が**同一オリジン**になるので、SPA→API のプリフライトは基本消える。
   `CORS_ORIGIN` は単一オリジン `https://fesflow.shikosai.net` に縮小 (または撤去)。
7. **better-auth**: `BETTER_AUTH_URL` → `https://fesflow.shikosai.net` (認証ハンドラは `/api/auth/*` のまま)。
   `trustedOrigins` はワイルドカード廃止し `https://fesflow.shikosai.net` + localhost。
   Cookie は**同一オリジン化で SameSite=Lax が素直に効く**(クロスサブドメイン設定不要 → よりセキュア)。
8. **アップロード配信**: `GET /uploads/*` を **`/api/uploads/*`** へ移動 (route を `/api` に寄せるため)。
   `R2_PUBLIC_URL` → `https://fesflow.shikosai.net/api/uploads`。
   ⚠ **既存データの後方互換**: 既に保存済みの `menu.imagePath` 等は
   `https://api.fesflow.shikosai.net/uploads/...` の**絶対URL**。単一ドメイン移行後もこれらを
   生かすには (a) 旧 `api.` サブドメインを当面残す / (b) DB 一括置換マイグレーション のいずれか。要判断。
9. **HSTS/セキュリティヘッダ** (`api/src/index.ts` の `/uploads` 例外コメント): 同一オリジン化に合わせ見直し。
10. **リンク総点検**: `ExternalRedirect` / `VISITOR_BASE_URL` / QR生成 (`Qr.tsx`, visitor の店頭QR) の
    向き先を新パスへ。QR に焼き込む URL は**印刷物として出回る**ため、移行タイミングに注意。

---

## 6. 移行手順 (案) とロールバック

1. アプリ側 (§5 の 2〜10) を**新パス構成でビルドできる状態**にする (サブドメインでも動く互換を保ちつつ)。
2. ステージング相当で方式Aの route を貼り、`/` `/circle/register` `/event` `/sys` `/api/*` を疎通確認。
3. QR の焼き直しが要るもの (店頭/事前注文) を洗い出し、旧URLからの**リダイレクト救済**を用意
   (旧 `api.`/`staff.`/`admin.` を残し新パスへ 301)。
4. 本番 route 切替 → 監視。問題時は wrangler route を旧 `custom_domain` に戻すだけで**即ロールバック**可。

---

## 7. ローカル開発

- 現行はアプリごとにポート (register/visitor/api)。単一ドメインを再現するには:
  - 案1: Vite dev の `server.proxy` で `/api` を 8787 へ、`/circle` 等を register dev へ寄せる単一入口。
  - 案2: 方式B のゲートウェイ Worker をローカルでも通す (`wrangler dev` + service binding)。
- `VITE_API_URL` の localhost フォールバックは、単一オリジン化後は「同一オリジン相対 `/api`」を
  既定にしてプロキシ前提へ変更する。

---

## 8. 推奨まとめ

- **方式A (パスパターン route) + register は固定 asset プレフィックス & 動的 basename** を推奨。
- 実装は概ね「①register のルート再編(接頭辞除去+共有ルート移設) → ②Vite/base/basename →
  ③env相対化+スペース切替簡素化 → ④wrangler route/CORS/auth/uploads → ⑤QR/リンク総点検」の順。
- 最も注意すべきは **(a) register 3スペース兼用の basename 化**、**(b) 既存 imagePath 絶対URLの後方互換**、
  **(c) 印刷済みQRの救済リダイレクト** の3点。

> 次アクション: この方式で問題なければ実装フェーズへ。パス微調整 (`/circle/register` の綴り、`/sys` 配下の
> 具体ルート等) があればコメントで。
