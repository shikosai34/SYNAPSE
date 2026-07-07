/**
 * API エラーエンベロープの共有型 (Phase4: API契約再設計)
 *
 * 背景: 従来は各ルートが `c.json({ error: "文字列" }, status)` を135箇所バラバラに手書きし、
 * フロントは文字列以外の情報 (どの種類の失敗か、どのフィールドが悪いか) を一切区別できなかった。
 * ここでバックエンド(apps/api)とフロント(apps/register, apps/visitor)の双方が import する
 * 「エンベロープの形」だけを定義し、両側で1つの真実の情報源にする。
 *
 * 意図的にやらないこと:
 * - Hono RPC (hono/client) への全面移行はしない。型共有はこの薄い契約のみに留める。
 * - message は「ユーザーに見せてよい日本語文言」であることを前提にする
 *   (INTERNAL 等、内部詳細を含み得るものは呼び出し側で汎用文言に丸めてから message に入れる)。
 */

/**
 * エラー種別コード。フロントはこのコードで UX を分岐する (401→ログイン誘導, 429→再試行秒数 等)。
 * ステータスコードとの対応 (apps/api/src/http-error.ts の STATUS_TO_CODE と一致させること):
 *   400: BAD_REQUEST / VALIDATION, 401: UNAUTHORIZED, 403: FORBIDDEN, 404: NOT_FOUND,
 *   409: CONFLICT, 429: RATE_LIMITED, 500: INTERNAL
 */
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

/**
 * API が返すエラーレスポンスの本文形状。
 * - fields: zod バリデーション失敗時のみ付与。キーはフィールドパス (例: "name", "items.0.menuId")、
 *   値はユーザー向け日本語メッセージ。
 * - requestId: 全エラーレスポンスに必須。サーバログと画面表示の両方に出し、
 *   問い合わせ時にログを requestId で引けるようにする。
 */
export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  fields?: Record<string, string>;
  requestId: string;
}
