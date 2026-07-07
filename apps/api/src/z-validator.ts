/**
 * zValidator 共通ラッパー (Phase4: API契約再設計)
 *
 * 背景: 素の `zValidator("json", schema)` はバリデーション失敗時に
 * `@hono/zod-validator` の既定挙動 (生の zod issues を含む 400 JSON) をそのまま返しており、
 * 統一エラーエンベロープ ({ code, message, fields, requestId }) と形が揃っていなかった。
 *
 * ここでは全ルートの `zValidator("json", schema)` をこの `zBody(schema)` に置き換え、
 * 失敗時は zod の issues を `fields` (フィールドパス→日本語メッセージ) に変換して
 * VALIDATION エンベロープを投げる (http-error.ts の onError が最終整形する)。
 *
 * 対象はほぼ "json" ターゲットだが、wristband.ts の検索エンドポイントのみ "query" を使うため
 * zQuery も用意する (実装は zBody と同じ形で target だけ異なる)。
 */
import { zValidator } from "@hono/zod-validator";
import type { z, ZodType } from "zod";
import { validationError } from "./http-error";

/**
 * zod issues (path + message) を `{ "circleId": "必須です", "items.0.menuId": "..." }` の
 * ようなフラットな fields マップに変換する。ネストしたパスは "." 区切りで連結する。
 */
function issuesToFields(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "_root";
    // 同じフィールドに複数エラーがある場合は最初のメッセージを優先する (トースト/フォーム表示の簡潔さ優先)
    if (!(path in fields)) {
      fields[path] = issue.message;
    }
  }
  return fields;
}

/**
 * `zValidator("json", schema)` の置き換え。バリデーション失敗時は VALIDATION エンベロープ
 * (400, fields 付き) を throw する。成功時は素の zValidator と同じく `c.req.valid("json")` で
 * パース済みデータを取得できる。
 */
export function zBody<T extends ZodType>(schema: T) {
  return zValidator("json", schema, (result) => {
    if (!result.success) {
      const fields = issuesToFields(result.error.issues);
      validationError(fields);
    }
  });
}

/** `zValidator("query", schema)` の置き換え版。挙動は zBody と同じで対象が query string。 */
export function zQuery<T extends ZodType>(schema: T) {
  return zValidator("query", schema, (result) => {
    if (!result.success) {
      const fields = issuesToFields(result.error.issues);
      validationError(fields);
    }
  });
}

export type inferBody<T extends ZodType> = z.infer<T>;
