/**
 * 統一エラーエンベロープ ({ code, message, fields?, requestId }) の回帰テスト (Phase4)。
 *
 * 対象:
 * - zBody (zValidator 共通ラッパー) のバリデーション失敗が VALIDATION + fields を返すこと
 * - 未定義ルートが NOT_FOUND エンベロープを返すこと (app.notFound)
 * - 予期しない例外が requestId 付きの INTERNAL エンベロープに丸められること (app.onError)
 *
 * いずれも apps/api/src/http-error.ts (registerErrorHandlers) / z-validator.ts (zBody) が
 * 対象。詳細な形状は ApiErrorBody (@fesflow/config) を参照。
 */
import { describe, expect, it } from "vitest";
import type { ApiErrorBody } from "@fesflow/config";
import { postJson, request, uid } from "./helpers";

describe("統一エラーエンベロープ", () => {
	it("zBody バリデーション失敗は 400 VALIDATION + fields を返す (POST /api/staff)", async () => {
		// circleId を欠落させ、name も空文字にしてバリデーションを2箇所同時に失敗させる。
		const res = await postJson("/api/staff", { name: "" });
		expect(res.status).toBe(400);
		const data = (await res.json()) as ApiErrorBody;
		expect(data.code).toBe("VALIDATION");
		expect(typeof data.requestId).toBe("string");
		expect(data.fields).toBeDefined();
		// circleId (z.string() 必須) と name (min(1)) の両方がフィールドエラーとして返る
		expect(Object.keys(data.fields ?? {})).toEqual(
			expect.arrayContaining(["circleId", "name"]),
		);
	});

	it("未定義ルートは 404 NOT_FOUND エンベロープを返す (app.notFound)", async () => {
		const res = await request(`/api/${uid("no-such-route")}`);
		expect(res.status).toBe(404);
		const data = (await res.json()) as ApiErrorBody;
		expect(data.code).toBe("NOT_FOUND");
		expect(typeof data.message).toBe("string");
		expect(typeof data.requestId).toBe("string");
	});

	it("存在しないネストパスも 404 NOT_FOUND エンベロープを返す", async () => {
		const res = await request("/api/festivals/not-a-real-sub-route/deeply/nested");
		expect(res.status).toBe(404);
		const data = (await res.json()) as ApiErrorBody;
		expect(data.code).toBe("NOT_FOUND");
	});

	it("不正なJSON本文は Hono 標準の HTTPException 経由で BAD_REQUEST エンベロープになる", async () => {
		// hono/validator の "json" ターゲットは c.req.json() 自体が失敗すると
		// zBody の hook より手前で HTTPException(400) を投げる。onError の
		// HTTPException 分岐 (statusToCode) が正しく拾い、素の Hono エラー形状ではなく
		// 統一エンベロープに変換されることを確認する。
		const res = await request("/api/staff", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{ this is not valid json",
		});
		expect(res.status).toBe(400);
		const data = (await res.json()) as ApiErrorBody;
		expect(data.code).toBe("BAD_REQUEST");
		expect(typeof data.requestId).toBe("string");
		expect(data.requestId.length).toBeGreaterThan(0);
	});

	it("予期しない例外 (ハンドラ内の TypeError 等) は 500 INTERNAL + requestId に丸められる (app.onError)", async () => {
		// circleId に配列を渡すなど、バリデーションを回避しつつハンドラ内で予期しない型エラーを
		// 誘発するのは困難なため、ここでは http-error.ts の registerErrorHandlers を直接呼び出し、
		// 汎用 Error を投げた場合の整形結果を単体で検証する (ルーティングを経由しない最小テスト)。
		const { Hono } = await import("hono");
		const { registerErrorHandlers } = await import("../src/http-error");
		const testApp = new Hono();
		registerErrorHandlers(testApp);
		testApp.get("/boom", () => {
			throw new Error("予期しない内部エラー (テスト用)");
		});

		const res = await testApp.request("/boom");
		expect(res.status).toBe(500);
		const data = (await res.json()) as ApiErrorBody;
		expect(data.code).toBe("INTERNAL");
		// 内部詳細 (スタックトレース・元のメッセージ) を画面に出さず、汎用文言のみ返すこと
		expect(data.message).toBe("サーバーエラーが発生しました");
		expect(typeof data.requestId).toBe("string");
		expect(data.requestId.length).toBeGreaterThan(0);
	});
});
