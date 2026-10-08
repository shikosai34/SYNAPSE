# FesFlow API リファレンス

最終確認: 2026-10-08。現行 Worker のソースを基準にしたルート概要です。API バージョン番号や OpenAPI 定義はこのチェックアウトにはなく、以下は公開済みの長期互換契約を保証するものではありません。認可や検証は各ハンドラーの実装を優先してください。

## 接続と基本

- ローカル API: `http://localhost:8787`。起動手順は [DEVELOPMENT.md](./DEVELOPMENT.md) を参照。
- Worker のRESTルートは `/api/*`。ルート本体は [apps/api/src/index.ts](../apps/api/src/index.ts)、ドメイン別定義は [apps/api/src/routes](../apps/api/src/routes/) にあります。
- JSON本文は `Content-Type: application/json`。CORSの許可メソッドは `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`。許可ヘッダーは `Content-Type`, `Authorization`, `Cookie`, `Accept`, `X-Active-Membership-Id`, `Idempotency-Key`、公開ヘッダーは `X-Request-ID` です。資格情報を使う場合はブラウザーから `credentials: "include"` を指定します。
- ブラウザーのCORS許可OriginはFesFlowドメイン、localhost/127.0.0.1、プライベートIP、および `CORS_ORIGIN` 設定値です。サーバー間HTTP通信にはブラウザーCORSは適用されません。
- 認証方式は Better Auth のセッションCookieです。ログインは `/api/auth/*` の Better Auth エンドポイントを使います。Google OAuth は `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` の設定が必要で、パスキーも利用できます。メール/パスワードは既定で無効で、`ENABLE_EMAIL_PASSWORD=true` の場合だけ有効になります（認可テスト用。通常の開発・本番ログイン方式ではありません）。汎用APIキーや外部サービス用Bearerトークン発行APIは確認できません。
- `/api/auth/*` は Better Auth 管理の個別仕様です。以下のJSONエラー包絡とは形が異なる場合があります。

## 認証・認可

| 呼び出し主体 | 使う資格情報 | 認可の境界 |
| --- | --- | --- |
| 匿名クライアント | なし | 公開GET、または公開導線の個別ハンドラーのみ。ルートが存在することだけでは公開可を意味しません。 |
| 来場者 | 発行済みリストバンドID、`eventUser.id`、またはQRに含まれるコード | 一部の注文履歴、事前注文、スタンプ、レビュー、抽選APIはコードを本人資格情報のように受け取り、そのIDのデータに絞ります。これはCookieログインではなくベアラー値で、漏えい・共有されたコードを別人が使うことを一般に防ぐ仕組みではありません。 |
| イベント/サークル運営者 | Better Auth Cookie + `X-Active-Membership-Id` | 操作対象に対する有効な所属とロールをサーバーが確認します。 |
| システム管理者 | Better Auth Cookie + `super_admin`。一部テナント操作は監査付きの一時的な権限昇格/なりすましが必要 | `super_admin` の肩書きだけではテナント内容を閲覧・変更できません。 |

スタッフ向けの所属依存APIでは、`X-Active-Membership-Id` にログイン中ユーザー本人が持つ有効な所属IDを送ります。サーバーはIDの所有者・有効状態を確認してからスコープを評価します。省略すると、そのリクエストは権限チェックに通りません。ロールと権限の正本は [packages/config/src/authorization.ts](../packages/config/src/authorization.ts)、実効判定は [apps/api/src/utils/auth.ts](../apps/api/src/utils/auth.ts) です。

基本ロールは `event_manager`, `circle_manager`, `circle_admin`, `circle_staff`, `super_admin`。イベント/サークルの所属、イベントの高度な権限設定、イベント終了後の読み取り専用化、オーナー専用操作などにより実効権限が変わるため、画面上の表示やロール名だけでアクセス可否を決めず、APIの応答を扱ってください。個別の業務操作ではこの共通表に加え、ハンドラー固有の条件もあります。

## 主要ルート一覧

パスはすべて `/api` からの相対表記です。認証欄の「主体別」は、ハンドラーごとに公開、Cookieセッション、メンバー権限、来場者コードのいずれかを判定することを示します。

| メソッド | パス | 用途・認可の概要 |
| --- | --- | --- |
| `GET` | `/system/public`, `/system/announcements` | メンテナンス表示情報、公開お知らせ。公開。 |
| `GET` | `/festivals` | ログイン必須。所属しているイベントだけを一覧し、`super_admin` は全件を参照できる。 |
| `GET` | `/festivals/public` | 未入場の来場者がイベントを選ぶための公開一覧。削除済みを除き、ID・名称・説明・ロゴURLだけを返す。 |
| `GET` | `/festivals/:id` | 認証・所属権限なしでイベント詳細を参照できる公開ルート。 |
| `POST` | `/festivals` | イベント作成。ログインセッション必須。作成者が `event_manager` になり、無料枠のイベントが作成される。 |
| `DELETE` | `/festivals/:id` | イベントの論理削除。`super_admin` セッション必須。 |
| `GET` | `/festivals/:id/analytics`, `/behavior`, `/contract`, `/daily-close`, `/inventory`, `/visitors`, `/orders/live` | 分析、行動、契約、日次集計、在庫、来場者一覧、注文状況。対象イベントの権限を確認。`daily-close` は集計取得であり締め確定APIではない。分析・日次締めはキャンセル以外の注文を集計し、未完了注文も含む。 |
| `PUT` | `/festivals/:id/advanced-permissions`, `/lifecycle-status`, `/lottery-enabled`, `/payment-methods` | イベント設定。対象イベントの権限と入力条件を確認。 |
| `PUT` | `/festivals/:id/stamp-rally-settings` | スタンプラリー設定。対象イベントの `event:write` 権限を確認。 |
| `PUT` | `/festivals/:id/theme` | テーマ・基本設定の更新または作成。`super_admin` セッション必須。 |
| `GET` / `POST` / `DELETE` | `/festivals/:id/announcements`, `/festivals/:id/announce`, `/festivals/:id/announcements/:announcementId` | 告知履歴取得 (`member:read`)、告知送信 (`member:write`)、履歴削除 (`member:write`)。削除しても配信済みの受信者通知は取り消されない。 |
| `PATCH` | `/circles/:id/settings`, `/mods`, `/wait-time` | サークル設定、モデレーション、待ち時間報告。対象サークルの権限を確認。 |
| `POST` | `/circles/:id/transfer-owner` | オーナー移譲。サークル権限に加えオーナー条件を確認。 |
| `GET` | `/circles`, `/circles/:id`, `/circles/:id/analytics` | サークル一覧/詳細/分析。公開一覧/詳細では代表者メールを権限なしに返さない。分析は所属権限を確認。 |
| `POST` / `PUT` / `DELETE` | `/circles`, `/circles/:id` | サークル作成・更新・論理削除。対象の所属権限を確認。 |
| `GET` / `POST` / `PUT` / `PATCH` / `DELETE` | `/menus`, `/menus/:id`, `/menus/:id/stock`, `/menus/:id/inventory` | メニュー参照 (`GET`) は公開。作成/編集/削除と在庫変更ではサークル権限を判定。 |
| `GET` / `POST` / `PUT` / `DELETE` | `/toppings`, `/toppings/:id`, `/toppings/:id/stock` | トッピング管理。サークルのメニュー/在庫権限等を確認。 |
| `GET` / `POST` / `PUT` / `DELETE` | `/staff`, `/staff/:id` | 店舗スタッフ情報の参照・管理。対象サークルのスタッフ権限。 |
| `GET` | `/orders?circleId=...&status=...`, `/orders/by-number/:orderNumber` | 注文一覧・番号検索。対象サークルの `order:read` 権限を確認。 |
| `GET` | `/orders/stats/sales` | 売上統計。対象サークルの `sales:read` 権限を確認。 |
| `GET` | `/orders/:id` | 注文IDを知っている利用者向けの公開照会。注文IDがベアラー値として働く。`cashierId` は応答から除外。 |
| `GET` | `/orders/user/:code` | 来場者本人の注文履歴。来場者コードで対象を絞り、応答項目を限定する。コードを秘密として扱う。 |
| `POST` | `/orders` | POS注文作成。JSON注文データと発行済み来場者IDが必要。再送には `Idempotency-Key` を推奨。 |
| `PATCH` / `POST` | `/orders/:id/status`, `/orders/:id/estimated-time`, `/orders/:id/complete` | 注文状態・見込み時間の更新/完了。スタッフ権限と許可された状態遷移を確認。 |
| `GET` | `/memberships/roles`, `/memberships/my`, `/memberships/circle/:circleId`, `/memberships/event/:eventId` | ロール定義、自分の所属、サークル/イベントのメンバー一覧。ログイン必須。所属一覧は本人に限定し、対象スコープのメンバー閲覧権限を確認。 |
| `POST` | `/memberships/check-permission` | ログイン中本人の権限を指定スコープで照会。`userEmail` はセッション本人と一致する必要がある。 |
| `POST` | `/memberships` | `{ userEmail, userName, circleId または eventId, role }` で所属を追加。対象スコープのメンバー管理権限が必要。イベント所属はイベント管理者のみ、サークル所属はサークルオーナーまたはイベント管理者が追加できる。システム管理者ロールの付与は `super_admin` のみ。 |
| `PATCH` / `DELETE` | `/memberships/:id/role`, `/memberships/:id/deactivate`, `/memberships/:id/reactivate`, `/memberships/:id` | ロール変更、停止/再開、削除。対象スコープのメンバー管理権限が必要で、最後のサークル管理者は停止・降格・削除できない。 |
| `POST` | `/memberships/invite`, `/memberships/invite/accept`, `/memberships/invite/:id/regenerate` | 招待作成、招待受諾、新しいtoken/codeで再発行。作成・再発行は対象スコープのメンバー管理権限が必要。 |
| `GET` | `/memberships/invite/lookup`, `/memberships/invite/list` | token/codeによる招待照会、管理者向け招待一覧。照会にはログインが必要で、一覧は対象スコープのメンバー管理権限が必要。 |
| `PATCH` / `DELETE` | `/memberships/invite/:id/extend`, `/memberships/invite/:id` | 招待期限の延長、招待削除。対象スコープのメンバー管理権限が必要。 |
| `GET` | `/memberships/notifications/list` | ログイン本人に届いた未読通知の一覧。 |
| `POST` | `/memberships/notifications/:id/read`, `/memberships/notifications/:id/respond` | 本人の通知を既読化し、招待通知を承認/拒否。 |
| `GET` / `PATCH` / `DELETE` | `/account/*` | `GET /me`、`PATCH /profile`・`/email`、`DELETE /membership/:id`、`DELETE /`（アカウント削除）。本人のCookieセッション必須。 |
| `GET` / `POST` / `PATCH` | `/wristbands/*` | 来場者・リストバンドの検索/照会/発行/編集、スマートフォン発行、バッチ・CSV等。受付・管理用途。認証条件、検索項目、変更可能な値は「来場者・リストバンドAPI」を参照。`/lookup/:code` は認証なしで来場者行とバンド行を返すため、コードと応答を特に慎重に扱う。 |
| `GET` | `/pre-orders/user/:code` | 来場者コードによる未受取の事前注文一覧。 |
| `POST` | `/pre-orders` | ドラフト保存。発行済み来場者コード、同一イベント、受付状態等をサーバーで再検証。 |
| `POST` | `/pre-orders/:id/claim` | POSでのclaim。運営セッションと `order:write` 権限、注文条件を検証。 |
| `GET` / `POST` | `/stamps/*` | `GET /:userId` と `GET /visitor/:code` は認証なしでスタンプ情報を参照する。`POST /redeem` はログイン必須だが、ログイン利用者の権限・所属スコープ・対象 `userId` の所有確認はない。 |
| `GET` / `POST` / `DELETE` | `/lottery/*` | 抽選設定・景品・抽選・応募・結果・当選受取。運営操作はイベント権限を確認する一方、`GET /:id/result?userId=...` は認証やID所有確認なしで指定IDの結果を返す。 |
| `GET` / `POST` | `/coupons/*` | サークルのクーポン管理、`/verify` で利用可否を確認。クーポン検証だけでは消費せず、注文確定側で再検証・適用する。 |
| `GET` / `POST` | `/reviews/*` | `/visitor/:code` の取得・投稿は認証なしでコードを受け取り、サークル/イベント側の一覧GETは `sales:read` を確認。コード照会の詳細は下記を参照。 |
| `GET` / `PUT` / `POST` / `PATCH` / `DELETE` | `/admin/*` | システム設定・告知・ユーザー/イベント/支払・監査・セッション整理・ロックアウト、権限昇格・なりすまし。全ルートで `super_admin` セッション必須。一部操作は再認証・昇格セッション必須。 |
| `POST` | `/upload` | ログインと有効な所属を要求するmultipartアップロード。10 MiB上限、許可拡張子のみ。 |
| `GET` | `/uploads/*` | 保存済み画像/フォント配信。公開キャッシュ付きバイナリで、JSON APIエラー包絡ではない。 |
| `GET` / `POST` 等 | `/auth/*` | Better Auth が提供する認証フロー。個別の認証プロトコルに従う。 |

### メンバーシップ・招待・通知の連携条件

- `/memberships/*` はログイン必須です。所属や招待を管理するルートは、対象イベント/サークルのメンバー管理権限も検証します。
- `POST /memberships` の本文は `{ userEmail, userName, circleId または eventId, role }` です。`userEmail` と `userName` は文字列、`role` は認可設定にあるロール値で、所属先は `circleId` または `eventId` のどちらかを指定します。イベント所属の追加は対象イベントの `event_manager`、サークル所属の追加は対象サークルの実ロール `circle_manager` またはイベント管理者が行えます。`super_admin` の付与/変更にはシステム管理者が必要です。
- `GET /memberships/invite/lookup?token=...` または `?code=...` は招待の種別、ロール、対象イベント/サークル、期限・使用上限を返します。`POST /memberships/invite/accept` は `{ token?, code?, userName }` を受け取り、ログイン中のメールアドレスで受諾します。招待が `targetEmail` に結び付いている場合、そのメールでログインする必要があります。
- `GET /memberships/invite/list?circleId=...` または `?eventId=...` は対象を一つ指定します。管理権限のある呼び出し元には共有用の `token` と `code` が返るため、応答を公開ログや無関係な外部サービスへ送らないでください。作成時の有効期限は1〜168時間 (省略時24時間)、最大使用回数は1〜100です。
- `PATCH /memberships/invite/:id/extend` は `{ expiresInHours }` (1〜168、既定168) で期限を延ばします。`POST /memberships/invite/:id/regenerate` は新しいtoken/codeを作り、旧招待は履歴のため残します。`DELETE /memberships/invite/:id` は招待を削除します。
- `GET /memberships/notifications/list` はログイン本人の未読分だけを返します。既読化は `POST /memberships/notifications/:id/read`、招待への回答は `POST /memberships/notifications/:id/respond` に `{ action: "accept" | "decline", userName? }` を送ります。
- `GET /festivals/:id/announcements` は `member:read` 権限を要求し、イベントの告知履歴を新しい順に返します。履歴削除は `DELETE /festivals/:id/announcements/:announcementId` で行いますが、受信者ごとに既に作成された通知は削除されません。

### 集計値の意味

- `GET /festivals/:id/analytics` と `GET /festivals/:id/daily-close?date=YYYY-MM-DD` は、`cancelled` 以外の注文を売上・注文数に含めます。`pending` など未完了注文も含む受注額で、入金済み金額を示すものではありません。`completedRate` は完了件数を別に算出します。
- サークルの売上管理画面は注文一覧から `completed` の注文だけを売上として集計します。イベント側の精算・日次集計とサークル売上画面では集計対象が異なるため、数値を直接同一視しないでください。
- `daily-close` は指定日の集計を返す読み取りAPIです。締め状態の保存、会計確定、入金処理は行いません。

### 来場者・リストバンドAPI

`/wristbands/*` は一つの認証方式ではありません。来場者IDやバンドコードを本人資格情報として扱う公開ルートと、Cookieセッションおよびイベント所属権限を要求する運営ルートが混在します。

| メソッド | パス | 資格情報・権限 | 用途と注意 |
| --- | --- | --- | --- |
| `GET` | `/wristbands/search?eventId=...&query=...` | Cookie + 対象イベントの `member:read` | 来場者をニックネーム、呼出ID、好きな日付、バンドIDで検索。`bandType`, `accountStatus`, `profileStatus`, `offset`, `limit` (最大500), `sortBy`, `sortDirection` で絞り込み・ページング・整列。応答には来場者行と有効なバンド情報が含まれます。 |
| `GET` | `/wristbands/lookup/:code` | なし。コードを知っていることが資格情報として働く | 既存のバンドIDまたは来場者IDを照会し、来場者行とバンド行を返します。未知のコードは `404`。スマートフォンのみのイベントでバンドが未作成の場合、照会時に `sp_<userId>` を作成/再有効化する場合があります。URL中の `/w/ID` とチェックインURLの `wb` 値も受け付けます。 |
| `POST` | `/wristbands/issue` | `wristbandId` 省略時はなし。指定時はCookie + 対象イベントの `member:write` | `{ eventId, wristbandId? }` で来場者枠とスマートフォンID、または物理バンドを作成します。物理バンド指定時は対象イベントの所属と発行権限を確認します。 |
| `POST` | `/wristbands/register` | 既発行・未紐付けバンドの初回リンクはなし。新規バンド作成、別人に紐付いたバンドの再割当、既存有効バンドからの付替えは対象イベントの `member:write` | `{ userId, wristbandId }` でバンドを来場者へ紐付けます。発行済みのバンドを初めて自分のIDへ紐付ける操作と、スタッフによる再発行操作では条件が異なります。 |
| `POST` | `/wristbands/:id/report-lost` | なし。バンドIDを知っていることが資格情報として働く | 有効な物理/スマートフォンバンドを `lost` にします。既に無効なバンドは拒否します。再発行や利用制限を伴うため、コードを秘密として扱ってください。 |
| `PATCH` | `/wristbands/:id` | Cookie + バンドの所属イベントで `member:write` | `{ status, userId? }` でバンド状態を変更し、必要なら同じイベント内の来場者へ紐付けます。状態は `active`, `lost`, `replaced`, `revoked`, `smartphone`。イベントをまたぐ付け替えは拒否されます。 |
| `PATCH` | `/wristbands/user/:userId` | Cookie + 来場者の所属イベントで `member:write` | `{ nickname?, favoriteDate?, displayId?, status? }` でプロフィール、呼出ID、アカウント状態 (`available` / `banned`) を変更します。呼出IDの重複は `409` になります。 |
| `POST` | `/wristbands/onboard` | なし。来場者IDがベアラー値として働く | `{ userId, nickname, favoriteDate? }` で既存来場者の初回登録またはプロフィールを更新します。来場者IDを知る者は本人として扱われるため、第三者へ渡さずログにも残さないでください。 |
| `POST` | `/wristbands/issue-smartphone` | Cookie + 対象イベントの `member:write` | `{ userId }` で既存来場者へ `sp_<userId>` を発行/再有効化します。既存の有効な物理/スマートフォンバンドは `replaced` になります。詳細とバッチAPIは次節を参照してください。 |

### リストバンド一括連携

スタッフ管理画面で発行・取込履歴を作り、保存したURLから処理を再開できます。次のイベントAPIはすべてイベント所属権限を検証します。運営Cookieと `X-Active-Membership-Id` が必要です。

| メソッド | パス | 本文・動作 | 必要権限 |
| --- | --- | --- | --- |
| `GET` | `/wristbands/batches?eventId=...&offset=0&limit=20` | 履歴をページング取得 (`limit` は最大100)。 | `member:read` |
| `POST` | `/wristbands/batches` | `{ eventId, source: "generated" | "csv", urls, prefix?, suffixLength? }`。`urls` は `/w/ID` 形式のURL、またはID文字列の配列。生成元は最大50,000件。重複IDは `409`。 | `member:write` |
| `POST` | `/wristbands/batches/:batchId/process` | 保存済みURLを最大400件ずつ来場者・バンドへ登録し、進捗を返す。完了・競合状態では同じ履歴を返す。 | `member:write` |
| `GET` | `/wristbands/batches/:batchId/csv` | バッチのURLだけを `url` 列のCSVとして返す。`private, no-store`。 | `member:read` |
| `POST` | `/wristbands/import` | `{ eventId, urls }`。`urls` は1〜20件で、各値は `/w/ID` 形式のURLまたはID文字列。画面からの大きなCSVは20件単位で分割します。 | `member:write` |
| `POST` | `/wristbands/issue-smartphone` | `{ userId }`。既存の来場者にスマートフォン用バンドを発行し、現在の有効な物理/スマートフォン用バンドを `replaced` に変更します。バンドIDは `sp_<userId>` で、既存行があれば再有効化します。来場者発行や匿名オンボードではなく、対象イベントの運営権限が必要です。 | `member:write` |

`/wristbands/import` は印刷会社などから戻ったCSVの各IDを既存イベントへ結び付ける一括登録APIです。登録済みIDや入力内重複は `409` になります。バッチCSVはサーバーが直接CSVを返す唯一の確認済みCSV APIです。一般の来場者・注文・分析・精算CSVはAPIレスポンス自体がCSVではなく、SPAがJSON応答から組み立ててダウンロードします。

`POST /wristbands/issue-smartphone` は既存来場者に対する管理操作です。対象ユーザーのイベントに対する `member:write` 権限を要求し、同ユーザーの有効なバンドを置き換えたうえで、決定的なID `sp_<userId>` のスマートフォン用バンドを作成または再有効化します。新規来場者の自己発行に使う `/wristbands/issue` とは権限・副作用が異なります。

### 画像・フォントの保存と配信

- `POST /upload` はmultipartの `file` を受け取り、画像 (`jpg`, `jpeg`, `png`, `gif`, `webp`) またはフォント (`ttf`, `otf`, `woff`, `woff2`) のみ保存します。上限は10 MiBです。Cookieログインと有効な所属が必要で、応答は `{ path, key, ext }` です。
- `GET /uploads/*` は保存物をバイナリで配信し、公開のimmutable cacheを付けます。JSON APIエラー包絡の対象外です。書込み後の画像・フォントURLは公開される前提で扱ってください。
- 保存先は本番でWorkerのR2 binding、ローカル開発でS3互換のMinIOを使います。外部ソフトがR2/MinIOバケットへ直接接続する契約はなく、ファイル操作は上記HTTPルートを通します。

網羅的なHTTP動詞・バリデーション・権限条件は [apps/api/src/routes](../apps/api/src/routes/) が正本です。特に上表で「主体別」とした公開/来場者ルートは、アプリ画面から利用できるという理由だけで外部公開APIとみなさないでください。

### 認証なしで到達できる主な業務ルート

以下はCookieセッションなしでも実装上到達できるルートです。入力値や業務状態の検証は行いますが、外部クライアント向けの認証済みAPI契約を意味しません。

| メソッド | パス | 条件・注意 |
| --- | --- | --- |
| `GET` | `/menus`, `/menus/:id` | メニュー参照。`GET /menus` は `circleId` が必要。 |
| `POST` | `/orders` | 発行済み来場者 `userId` と注文条件を検証してPOS注文を作成。 |
| `GET` | `/orders/:id` | 注文IDによる注文・明細照会。IDを知る利用者が読めるため、URLやログへ不用意に記録しない。スタッフ内部情報の `cashierId` は返さない。 |
| `POST` | `/pre-orders` | ドラフト新規作成・自動保存。来場者ID等を検証し、更新にはCAS用のドラフトID/更新時刻が必要。 |
| `GET` | `/pre-orders/user/:code` | 来場者コードで未受取の事前注文を参照。コードは本人性を証明する強い認証ではない。 |
| `POST` | `/wristbands/onboard`, `/wristbands/issue`, `/wristbands/register` | オンボード、デジタルバンド発行、初回登録。`issue` は `wristbandId` を省略すると匿名で来場者とスマートフォンバンドを発行し、物理IDを指定するとログインセッションを要求する（このルート自身はスタッフ権限を確認しない）。 |
| `POST` | `/wristbands/:id/report-lost` | セッションなしで紛失報告し、active/smartphone のバンドを lost に変更する。コードを知る第三者が状態を変えられるため、外部連携から呼ばない。 |
| `GET` | `/wristbands/lookup/:code` | セッションなしでコード照会し、該当する来場者行とリストバンド行を返す。個人情報を含み得るため、URL・ログ・第三者サービスへ送らない。 |
| `GET` / `POST` | `/reviews/visitor/:code` | 認証なし。GETはコードに対応する来場者の訪問/購入済みサークルと本人レビューを返し、POSTは同じコードを使って対象サークルへ投稿・更新する。コードはベアラー値として秘密にする。 |
| `POST` | `/lottery/:id/enter`, `/coupons/verify` | 来場者応募、クーポン検証。各ハンドラーの状態・回数・対象条件を満たす必要がある。 |
| `GET` | `/stamps/:userId` | ID指定でスタンプと交換状態を参照。来場者ID自体を秘密として扱う必要がある。 |
| `GET` | `/stamps/visitor/:code` | 来場者コードでスタンプラリー設定と押印済みサークルを参照。コードは秘密として扱う。未設定または無効コードでは `enabled: false` と空配列を返す。 |
| `GET` | `/lottery/:id/result?userId=...` | 認証なし。指定した `userId` の応募/当選結果を返し、呼出者との同一性やイベント参加は確認しない。 |

来場者IDやリストバンドコードだけで本人を特定するAPIは、強いユーザー認証ではありません。値を知る利用者が別人の情報を参照したり操作したりできる経路があります。特に `GET /wristbands/lookup/:code` は来場者行とバンド行を返し、`POST /wristbands/:id/report-lost` はコードだけで有効なバンドを停止します。`GET /lottery/:id/result?userId=...` も指定IDの結果を認証なしで返します。`POST /stamps/redeem` はログインこそ必要ですが、対象来場者との関係やスタッフ権限を確認しません。`GET` / `POST /reviews/visitor/:code` はコードだけで来場者の訪問先・本人レビューを照会したり、レビューを投稿/更新したりできます。これらの値を公開クライアントへ埋め込んだり、ログやURLで共有したりしないでください。認証なしの書込みエンドポイントは、公開Web画面を成立させる実装上の導線であり、外部システムからの無制限利用を推奨するものではありません。

## リクエスト例

### 公開情報の取得

```sh
curl -i -A 'OpenAI File Downloader, XaiImageApiFetch/1.0' http://localhost:8787/api/system/public
```

成功例は `{"maintenance":{"enabled":false,"message":""}}` の形です。

### 店舗メニューを取得

```sh
curl -i -A 'OpenAI File Downloader, XaiImageApiFetch/1.0' 'http://localhost:8787/api/menus?circleId=<CIRCLE_ID>'
```

このGETは `circleId` が必要です。現行実装ではメニューとトッピングを含む配列を返します。読み取りはCookie認証なしで利用できます。書込みAPIはセッションとサークル権限の検証を追加で通ります。

### POS注文を作成

```sh
curl -i -A 'OpenAI File Downloader, XaiImageApiFetch/1.0' -X POST http://localhost:8787/api/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: <UNIQUE_REQUEST_KEY>' \
  --data '{
    "circleId": "<CIRCLE_ID>",
    "userId": "<ISSUED_EVENT_USER_ID>",
    "peopleCount": 1,
    "items": [{"menuId": "<MENU_ID>", "quantity": 1, "toppingIds": []}]
  }'
```

`userId` は受付発行等で既に登録された来場者IDである必要があります。イベント停止/開催期間、BAN状態、メニュー・在庫・価格、トッピング等をサーバーが検証します。成功応答は `201` と `{"id":"...","orderNumber":"..."}`。同じキーで同じ内容を再送すると同じ結果を返し、同じキーで内容を変更すると `409 CONFLICT` です。キー長など詳しくは [apps/api/src/services/order-commit.ts](../apps/api/src/services/order-commit.ts) と [packages/config/src/order-contract.ts](../packages/config/src/order-contract.ts) を参照。

Cookie認証が必要な運営APIのcurl例は、ログインCookieと有効な所属IDを安全に取得済みの場合に限り、次の形です。Cookieや実値をシェル履歴へ置かないでください。

```sh
curl -i -A 'OpenAI File Downloader, XaiImageApiFetch/1.0' 'http://localhost:8787/api/orders?circleId=<CIRCLE_ID>' \
  -H 'Cookie: <BETTER_AUTH_SESSION_COOKIE>' \
  -H 'X-Active-Membership-Id: <YOUR_ACTIVE_MEMBERSHIP_ID>'
```

## 主な業務APIの入力と副作用

ここでは外部クライアントが誤解しやすい事前注文、クーポン、スタンプ、抽選の境界だけを記します。これはOpenAPIの代替となる完全なスキーマではありません。正確なバリデーションと応答項目は各ルートの現行実装を参照してください。

### 事前注文

- `POST /api/pre-orders` は来場者 `userId`、`circleId`、`draftId`（1文字以上）、`expectedUpdatedAt`（新規時は `null`、更新時は直前に返された `updatedAt`）、`items` を受け取ります。明細は `menuId`、1以上の `quantity`（省略時1）、任意の `toppingIds` です。任意で最大10件の `{slug, passphrase}` クーポンを渡せます。
- 更新は `draftId` と `expectedUpdatedAt` の組で競合を検出します。古い更新時刻の書込みは競合エラーになります。クーポンと在庫等はサーバー側で検証し、注文確定時にも再評価します。
- `POST /api/pre-orders/:id/claim` は匿名ではありません。レジ運営者のセッションと `order:write` 権限を要求し、任意の `cashierId`、`paymentMethod` を受け取ります。

### クーポン

- `GET /api/coupons/circle/:circleId` は `coupon:read`、作成 `POST` と停止 `POST /api/coupons/:id/disable` は `coupon:write` を要求します。
- 公開の `POST /api/coupons/verify` は `{slug, passphrase, eventUserId}` を受け取り、利用可否をプレビューします。この確認だけでは利用回数を消費しません。
- 利用は事前注文作成時の `coupons` に指定し、サーバーが検証・適用します。プレビュー結果だけを信頼して値引きを確定しないでください。

### スタンプ

- `GET /api/stamps/visitor/:code` は発行済みのスマートフォン用バンドID、または `eventUser.id` でイベントの設定と押印済みサークルを返します。無効コードや未設定時は `{enabled:false,areas:[],stampedCircleIds:[]}` 相当です。
- `GET /api/stamps/:userId` はそのIDのスタンプ、交換状態、押印数を返します。どちらの値も本人性を証明する秘密情報として保護してください。
- `POST /api/stamps/redeem` はログインセッションを要求し、未交換かつ3個以上のスタンプがある指定 `userId` に交換記録を作ります。実装上、ログイン利用者のスタッフ権限・イベント/サークル所属・指定来場者との関係は確認しません。外部クライアントはこの実装上の認可不足を前提に呼び出さないでください。

### 抽選

- `GET /api/lottery?eventId=...` は `event:read` を要求します。運営用の抽選取得、作成 `POST /api/lottery`（`event:write`、`{eventId,name,drawAt?,entryConfig?}`）、景品追加 `POST /api/lottery/:id/prizes`（`{name,quantity}`）、景品削除 `DELETE /api/lottery/:id/prizes/:prizeId` はイベント権限が必要です。
- 来場者応募 `POST /api/lottery/:id/enter` は `{userId}` を受け取り、対象イベントへの登録状態と抽選受付状態を検証します。同じ利用者の再応募は冪等です。`GET /api/lottery/:id/result?userId=...` は認証なしで、指定された `userId` の応募/当選結果を返します。ID所有者の確認はないため、他人のIDを指定すればその結果も照会できます。
- `POST /api/lottery/:id/draw` は結果を永続化する抽選実行です。`POST /api/lottery/:id/winners/:winnerId/claim` は `event:write` を要求し、受取時刻を記録します。外部連携から抽選を再実行したり、結果を上書きしたりしないでください。

## 集計とライブ表示の意味

- `GET /api/orders/stats/sales` は完了済み注文だけを売上集計します。
- イベント/サークル分析、日次締め、精算の集計はキャンセル以外の注文を含みます。未完了注文の金額も表示されるため、`orders/stats/sales` と同じ数字になるとは限りません。日次締めは指定されたJST日付の範囲で集計し、締め状態を確定・ロックする操作ではありません。
- `GET /api/festivals/:id/orders/live` は通常のJSON GETで、未着手と調理中の注文のスナップショットを返します。SSE/WebSocketではないため、変化を追うクライアントは間隔を空けて再取得してください。

## 応答とエラー

成功応答は各ルート固有のJSON（配列、オブジェクト等）です。すべてが同じラッパーに包まれるわけではありません。APIハンドラーの標準エラーは次の形式です。

```json
{
  "code": "VALIDATION",
  "message": "入力内容を確認してください",
  "fields": {"items.0.quantity": "1以上を指定してください"},
  "requestId": "<REQUEST_ID>"
}
```

`fields` は入力検証エラー時にのみ付く場合があります。よくあるHTTPステータスは `400` 入力不正、`401` 未認証、`403` 権限不足、`404` 未検出、`409` 競合、`429` 制限、`500` 内部エラーです。`429` は `Retry-After` 秒数を返す場合があります。現在、レート制限が確認できるのはメール認証や登録済みパスキー検証など一部の `/api/auth/*` です。全API共通のクォータは定義されていません。全APIレスポンスは `X-Request-ID` を返し、エラー本文の `requestId` と一致します。`/api/uploads/*` とBetter Auth応答はこのJSONエラー形式の対象外です。

## 外部ソフトウェアからの連携範囲

**HTTPレベルでは、匿名で利用できる一部のRESTルートと、セッションCookieを扱えるクライアントから利用できる運営APIがあります。** ただし現時点で外部向けSDK、OpenAPI/Swagger定義、APIキー発行、汎用OAuthクライアント資格情報フロー、契約済み互換バージョンは確認できません。Webhook、決済代行サービス向けAPI、全API共通のクォータもありません。管理画面の支払記録は内部運営機能で、決済処理APIではありません。したがってルートの存在は、第三者向けサポート済みAPI契約を意味しません。

現行実装から確認できる連携方法:

- 公開情報GETや公開導線の一部はCookieなしでHTTP呼び出しできます（個別ハンドラーごとに確認してください）。
- メニュー取得や注文作成など、匿名で呼べる主要ルートもあります。匿名注文作成は既存の来場者IDを要求し、在庫・イベント状態等をサーバーが検証します。匿名であることは、外部連携向けの利用許可やSLAを意味しません。
- 運営連携はBetter AuthのセッションCookieを維持し、所属依存APIへ `X-Active-Membership-Id` を付ける必要があります。パスキー/GoogleログインはブラウザーリダイレクトやWebAuthnを含むため、ヘッドレスサーバー連携向け認証契約とは言えません。
- ブラウザーから呼ぶ場合はCORS許可Originの制限を受けます。許可Origin外のWebページから直接呼ぶ連携はできません。サーバー間呼び出しではCORSではなくAPI側の認証・認可が適用されます。
- 来場者フローの一部はQR/リストバンドコードをリクエストに含める方式です。注文IDによる注文照会も同様にIDを知る者が読み取れます。加えて、リストバンド照会は来場者行とバンド行を返し、紛失報告はコードだけで有効なバンドを停止します。これらの値は資格情報として保護し、アクセスログや解析サービスへの記録を避けてください。外部システムが任意コードを生成して使える仕組みではありません。
- リストバンドCSVのバッチ一括発行・取込はイベント権限付きHTTP APIがあります。来場者や注文などの画面CSVはSPAがJSON APIから生成し、外部ソフト用の独立CSV APIではありません。
- 画像・フォントは認証付きmultipart APIで登録できますが、取得URLは公開配信です。R2/MinIO直接接続や任意ファイル保存を外部ソフトへ提供するものではありません。
- 注文作成は `Idempotency-Key` による再送保護があります。ほかの書込みAPIに同じ冪等性があるとは限りません。

ブラウザー/運用手順が前提となる、またはHTTP APIで完結すると確認できない作業には、Google/パスキー認証UI、対面でのリストバンド発行や本人確認、システム管理者の再認証/昇格操作、画面上のスペース選択状態、CSVを使った作業手順があります。API経由で類似操作を行える箇所も、その操作自体が認められているとは限らないため、当該ルートのロール・監査・運用条件を満たす必要があります。録画/配信制御用 `apps/stream` は未着手であり、OBS連携APIはこのリファレンスに含めていません。

### システム管理API

以下のルートは `/api/admin` 配下で、全てログイン済み `super_admin` が必要です。一般のイベント/サークル運営者や外部ソフト用の管理APIではありません。HTTPメソッド、パス、主な用途は次のとおりです。

| メソッド | パス | 用途・追加条件 |
| --- | --- | --- |
| `GET` / `PUT` | `/admin/settings` | メンテナンス表示、終了済みイベントのデータ保持期間の取得/更新。更新本文は `maintenance: { enabled, message }` と `cleanup: { retentionDays }` の任意項目。保持期間は設定範囲内で監査記録される。 |
| `GET` / `POST` | `/admin/announcements` | 全体お知らせの一覧/作成。作成本文は `{ title, body?, level?, published? }`。 |
| `PATCH` / `DELETE` | `/admin/announcements/:id` | 全体お知らせの部分更新/削除。 |
| `GET` | `/admin/overview`, `/admin/events`, `/admin/users` | システム概要、契約情報付きイベント一覧、所属から集約したアカウント一覧。個人/契約データを含むため外部送信しない。 |
| `PATCH` / `DELETE` | `/admin/events/:id` | イベント名・プラン・サークル上限・契約状態/金額/メモの更新、または論理削除。契約・テナント状態を直接変える管理操作。 |
| `GET` / `POST` | `/admin/events/:id/payments` | 手動入金台帳の取得/入金記録。POST本文は `{ amount, method?, paidAt, note? }`。決済処理や資金移動は行わない。 |
| `DELETE` | `/admin/payments/:paymentId` | 手動入金記録の削除。 |
| `PATCH` | `/admin/memberships/:id` | システム所属のロール/有効状態変更。本文は `role?` と `isActive?`。自分自身や最後の有効 `super_admin` を無効化・降格できない。 |
| `GET` / `POST` | `/admin/sessions/expired-count`, `/admin/sessions/cleanup` | 期限切れセッション数の照会/期限切れセッションの削除。削除操作は監査対象。 |
| `GET` / `DELETE` | `/admin/lockouts`, `/admin/lockouts/:id` | 現在ロック中の認証試行一覧/ロック解除。 |
| `GET` | `/admin/sudo/status`, `/admin/impersonate/status` | 現在の昇格/なりすまし状態の照会。 |
| `POST` | `/admin/sudo/elevate`, `/admin/sudo/end` | 一時昇格の開始/終了。UIは開始前にパスキーで再認証し、APIはセッション作成から5分以内であることを確認する。昇格は15分で失効する。 |
| `POST` | `/admin/impersonate` | イベント/サークル運営者としての一時的ななりすまし。`sudo` 昇格状態が必要。本文のロールと `eventId`/`circleId` の組合せも検証する。 |
| `POST` | `/admin/impersonate/stop` | なりすまし終了。 |
| `GET` | `/admin/audit` | 直近200件の管理監査ログ。 |

`super_admin` セッションの存在だけで第三者システムが安全に管理操作を自動化できるわけではありません。UIはパスキー再認証後に一時昇格APIを呼び出し、APIはセッション作成時刻の新しさを確認します。ロール/契約/入金/テナント状態の変更は監査と運用判断を伴います。これらのルートを通常の外部連携に利用しないでください。

## 参照ソース

- ルート登録と共通ミドルウェア: [apps/api/src/index.ts](../apps/api/src/index.ts)
- Honoルート: [apps/api/src/routes](../apps/api/src/routes/)
- セッション/権限: [apps/api/src/middleware/auth.ts](../apps/api/src/middleware/auth.ts), [apps/api/src/utils/auth.ts](../apps/api/src/utils/auth.ts), [packages/config/src/authorization.ts](../packages/config/src/authorization.ts)
- エラー契約: [apps/api/src/http-error.ts](../apps/api/src/http-error.ts), [packages/config/src/api-error.ts](../packages/config/src/api-error.ts)
- 注文入力・冪等性: [packages/config/src/order-contract.ts](../packages/config/src/order-contract.ts), [apps/api/src/services/order-commit.ts](../apps/api/src/services/order-commit.ts)
- 認証とローカル起動: [AUTHENTICATION.md](./AUTHENTICATION.md), [DEVELOPMENT.md](./DEVELOPMENT.md)
