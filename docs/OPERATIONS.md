# FesFlow 運用と判断待ち

最終更新: 2026-10-03。Issue #91〜#94と同期する。

## 5,000人の負荷受入

#92にある到着率500操作/秒を30分、1,000操作/秒を10分、短時間2,500操作/秒のステージング目標を使う。5,000アクティブセッションを維持しながら開ループ到着率、完了率、p95/p99、5xx、D1クエリ時間/読み書き量、Worker CPU、キューと費用を測る。単一サークルへの集中、人気商品、低在庫、本人再送、厨房画面、同一NATも含める。DB/Cloudflareの契約上限と許容費用を確認し、production secretや実利用者データを負荷生成へコピーしない。

初期SLO案: read p95≤500ms、確定注文p95≤1秒・p99≤2秒、目標負荷時の予期しない5xx<0.1%、二重注文・過剰販売・保存矛盾0。正常な在庫切れや意図した業務拒否は5xxと別に数える。これらは製品側の確定SLOではなく負荷検証用の提案値。

## 開催後のデータ削除

既存の60日を候補期限として維持する。Cronは `lifecycle_status` がended/archivedで、endDateが期限を越え、関連データが残るイベントを一度に最大20件処理する。各イベントの削除は8テーブルをD1 `batch()` にまとめ、実行時も状態を再確認する。ID集合を巨大なIN文にしないのでバインド数を固定する。

事前確認はCron結果ログの候補・処理数とテーブル別件数を照合する。2026-10-03の判断により、`CLEANUP_ENABLED=true` が明示されるまでscheduled cleanupはdry-runのままで、未設定は削除禁止となる。`CLEANUP_DRY_RUN=true` は有効化後も削除を止める追加の安全弁。学校・会計規程、対象範囲、バックアップ/restore手順が確認できるまで本番では有効化しない。

以下は正式判断待ち（#83）:

- 60日保持が注文・会計資料・法令や学校規則を満たすか。
- 削除/保持の対象テーブル、アップロード画像・会計書類・監査履歴の対象範囲。
- ended/archivedの起点、終了後の再開における保持時計。
- 本番dry-runと本削除を切替える承認者・日付。

## 依存監査

`bun run audit:dependencies` はbun.lock内の直接・間接・optional・開発パッケージの解決版をnpm advisoryとOSVへ送り、両サービスのエラーや不一致も無視しない。現時点でesbuild 0.18.20一組のみ、期限2026-11-02の例外がある（#93）。`bun run test:tooling`とCIも実行する。例外を期限内に解消するか、理由・期限を再承認する。

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
