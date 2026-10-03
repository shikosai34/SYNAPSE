# FesFlow 運用と判断待ち

最終更新: 2026-10-04。Issue #83、#85、#89、#90、#93と同期する。

## 5,000人の負荷受入

#92の本番相当容量試験はユーザー判断により優先度を下げ、今回は実施しない。将来再開する場合は到着率500操作/秒を30分、1,000操作/秒を10分、短時間2,500操作/秒のステージング案を基に、5,000アクティブセッションの開ループ到着率、完了率、p95/p99、5xx、D1/Worker負荷と費用を測る。production secretや実利用者データを負荷生成へコピーしない。

初期SLO案: read p95≤500ms、確定注文p95≤1秒・p99≤2秒、目標負荷時の予期しない5xx<0.1%、二重注文・過剰販売・保存矛盾0。正常な在庫切れや意図した業務拒否は5xxと別に数える。これらは製品側の確定SLOではなく負荷検証用の提案値。

#94の同一NAT認証負荷試験も優先度を下げた。識別子別の段階遅延は実装済みだが、本番相当の混合試験は未実施。Google OAuth開始時はログイン識別子がWorkerに渡らず、この遅延の対象外となる。

## 開催後のデータ削除

保持期間はユーザー判断により **365日（1年）を既定値** とし、システム管理画面で30〜3,650日の範囲に変更できる。値はシステム設定に保存され、Cronは `lifecycle_status` がended/archivedで、`endDate < 現在時刻 - 保持日数` かつ関連データが残るイベントを一度に最大20件処理する。各イベントの削除は8テーブルをD1 `batch()` にまとめ、実行時も状態を再確認する。ID集合を巨大なIN文にしないのでバインド数を固定する。

保持期間を変更しても自動削除は有効にならない。2026-10-03の判断により、`CLEANUP_ENABLED=true` が明示されるまでscheduled cleanupはdry-runのままで、未設定は削除禁止となる。`CLEANUP_DRY_RUN=true` は有効化後も削除を止める追加の安全弁。学校・会計規程、対象範囲、バックアップ/restore手順が確認できるまで本番では有効化しない。今回も本番設定・データには触れない。

この保持設定は現在の自動削除対象8テーブルにだけ適用する。アップロード画像、会計資料、監査ログ等はこの削除ジョブの対象外で、保存先ごとの保持方針を別途決める。

正式確認待ち（#83）:

- 365日という設定値と、システム管理者が30日まで短縮できる運用が学校・会計規程を満たすか。
- 削除/保持の対象テーブル、アップロード画像・会計書類・監査履歴の対象範囲。
- ended/archivedの起点、終了後の再開における保持時計。
- 本番dry-runと本削除を切替える承認者・日付。

自動削除の有効化はこの確認とバックアップ/restore手順の演習後に別途承認する。

## #90 非本番復旧演習

復旧手順の確認は、作業用一時ディレクトリに独立したローカルD1を作り、合成データだけをexportして別の空D1へrestoreする。通常の `.wrangler` ローカルDBやremote D1には接続しない。schema/migrationと合成probe行が復元後に読めることを確認し、演習の成否・コマンド・限界をこの資料とIssueへ記録する。本番復旧手順の承認や実際のbackup保持・暗号化確認とは区別する。

2026-10-04に実施し、全25 migrationの適用、合成probeのexport/import、restore先でのprobe読取りまで成功した。これはwrangler上のローカルD1 export/import確認であり、Cloudflare remote backup取得、非本番リリース、RPO/RTO、暗号化、運用担当者の復旧手順までは検証していない。

## 依存監査

`bun run audit:dependencies` はbun.lock内の直接・間接・optional・開発パッケージの解決版をnpm advisoryとOSVへ送り、両サービスのエラーや不一致も無視しない。#93のesbuild 0.18.20例外は修正版0.25.12へのoverrideで削除済み。監査、tooling test、DB migration生成、Worker/SPA buildで互換性を確認する。

## 残作業

- #85: CIのmigration適用テストとmain/devのrequired status check（`Quality / verify`）は設定済み。主要シナリオのブラウザーE2EとGitHub上の最初のrequired-check結果確認が残る。
- #89: 設定変更の監査記録と構造化request logは実装済み。権限変更・削除等の業務監査結果、ログ保持期間/閲覧権限、遅延指標と通知方針が残る。
- #90: isolated local D1 export/restoreは演習済み。非本番release、Cloudflare backup、RPO/RTOを含む運用者立会い演習が残る。

## 障害確認

- HTTP応答の`X-Request-ID`を控える。Workerの構造化access logは同じIDを記録する。
- 既定では成功を1%記録し、4xx/5xxは全件記録する。`REQUEST_LOG_SAMPLE_RATE`は0..1。ルートtemplate以外のURL、query、HTTP body、cookie、認証情報、IPは出力しない。
- 個人データを含む注文内容やSQL/bind値をエラーmessageとして返さない。注文の再送にはクライアント生成の`Idempotency-Key`を使う。

## 変更手順

1. PRのCI結果、生成SQL、dry-run Worker bundleを確認する。
2. 本番前に`apps/api/wrangler.jsonc`のCloudflare account / D1 database binding / routeと適用済みmigrationを独立に照合する。現在の値を現行productionと推定しない。
3. backup/exportと復元手順を確認し、migrationを適用する。
4. 対象のAPIまたはSPAだけをデプロイし、HTTP、認証・権限、注文、アップロードを確認する。
5. 戻すときはWorker/SPAの版を戻す。後方互換性を確認せず、D1 migrationを自動で巻き戻したりデータを消したりしない。

アカウント・契約plan・remote migration・バックアップ状態・本番負荷はこの実装タスクでは読み書きしていない。
