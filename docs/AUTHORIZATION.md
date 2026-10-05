# 権限と表示スコープ

権限のロール名とロール別 permission 一覧は `packages/config/src/authorization.ts` を正本とし、API/DB と管理画面で共有する。現在のロールは `super_admin`、`event_manager`、`circle_manager`、`circle_staff` の4種。表示ラベルは `apps/app/src/lib/roles.ts` に置く。

認可の実効スコープはサーバーの `hasPermission` が決める。リクエストの `X-Active-Membership-Id` はログインユーザーが実際に持つ所属として検証され、イベント/サークルの親子関係に従う。ブラウザーの `circleAuth` はスペース選択と表示のための状態であり、保存された `isEventAdmin` フラグ単独で権限を追加しない。システム管理者のテナント操作は、サーバー状態に基づく監査付き impersonation を通す。

## 高度な権限管理 (2026-10-05)

`event.advancedPermissions` (既定 OFF、イベント管理者が設定タブで切り替え) が OFF のイベントでは、サークルに所属する `circle_staff` を `circle_manager` 相当で評価する。ON にすると従来どおり `circle_manager` / `circle_staff` の権限差が効く。`membership.role` は書き換えず、`effectiveCircleRole` (`packages/config/src/authorization.ts`) を通して評価時だけ差し替えるため、ON に戻せば元のロール構成が復活する。

- API: `hasPermission` (`apps/api/src/utils/auth.ts`) と `checkMemberWritePermission` (`apps/api/src/routes/membership.ts`) が実効ロールで判定する。`GET /api/memberships/my` は画面表示用に `effectiveRole` / `advancedPermissions` を返す。
- 変わらないこと: `circle_manager` への昇格や既存 `circle_manager` の操作は引き続き `event_manager` / `super_admin` のみ。OFF ではロール選択 UI を隠す。サークル・イベントのスコープと閲覧のみモードの制限も変わらない。

ヘッダーのスペース選択に現在のロールと画面権限を表示する。所属一覧は画面フォーカス時と所属変更後に再取得し、削除済み/権限変更済みの選択を反映する。所属/認証情報の取得エラーは失効と区別し、401 が確認できた場合だけログインへ戻す。それ以外の通信エラーでは保存状態を消さず、管理画面を閉じて再試行を案内する。最終的な操作可否は常に API が検証する。

来場者の公開下見は匿名状態で利用できる。イベント入場済み来場者は自身の `eventId` に属する出店メニューと注文導線を使い、別イベントの明示 URL は自身のイベントへ戻す。リストバンド発行前のイベント選択/発行導線は維持する。来場者用 API の公開可否やイベント状態ポリシーは、この表示制御から推測して変更しない。

権限を追加/変更するときは、共有 `ROLE_PERMISSIONS`、対象 API のスコープ検証、管理画面の権限表示/ガードを一緒に見直し、`bun run check-types` と `bun run build` および関連 API テストを実行する。
