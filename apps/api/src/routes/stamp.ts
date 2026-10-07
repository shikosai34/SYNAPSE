import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import { userStamp, rewardRedemption, eventUser, wristband, event, circle, order } from "@fesflow/db";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { ulid } from "ulidx";
import { getSession } from "../utils/auth";
import type { AppEnv } from "../types";

// 2026-07-08 (Phase5): db はモジュール Proxy ではなく c.get("db") で受け取る (ALS撤去)。
const stampRoutes = new Hono<AppEnv>();

// 2026-07-06: 景品交換に必要なスタンプ数を定数化。
// 本来はイベント/サークル単位で設定可能にすべきだが、スキーマ変更を伴うため
// 今回はスコープ外とし、まずハードコードされたマジックナンバーを定数化するに留める (今後の課題)。
const REQUIRED_STAMP_COUNT = 3;

type StampRallyAreaSetting = {
  id: string;
  name: string;
  requiredCount: number;
  circleIds: string[];
  rewardTitle: string;
  rewardDescription: string;
};

function parseStampRallySettings(raw: string | null | undefined) {
  try {
    const value = JSON.parse(raw || "{}") as { enabled?: unknown; areas?: unknown };
    const areas = Array.isArray(value.areas)
      ? value.areas.filter((area): area is StampRallyAreaSetting =>
          !!area && typeof area === "object" &&
          typeof area.id === "string" && typeof area.name === "string" &&
          Number.isInteger(area.requiredCount) && area.requiredCount > 0 &&
          Array.isArray(area.circleIds) && area.circleIds.every((id: unknown) => typeof id === "string")
        )
      : [];
    return { enabled: value.enabled === true, areas };
  } catch {
    return { enabled: false, areas: [] as StampRallyAreaSetting[] };
  }
}

// 2026-10-07: 利用実績は来場者本人の完了注文をサークル単位に集約する。
// 過去の注文受付時に発行された user_stamp はそのまま残しつつ、再購入や他イベントの
// スタンプで進捗が二重計上されないよう、イベント設定の対象サークルだけを返す。
stampRoutes.get("/visitor/:code", async (c) => {
  const db = c.get("db");
  const code = c.req.param("code");
  const wristbands = await db
    .select({ id: eventUser.id, eventId: eventUser.eventId })
    .from(wristband)
    .innerJoin(eventUser, eq(wristband.userId, eventUser.id))
    .where(and(
      eq(wristband.id, code),
      or(eq(wristband.status, "active"), eq(wristband.status, "smartphone")),
      eq(eventUser.status, "available"),
    ));
  const directUsers = wristbands.length === 0
    ? await db.select({ id: eventUser.id, eventId: eventUser.eventId })
        .from(eventUser).where(and(eq(eventUser.id, code), eq(eventUser.status, "available")))
    : [];
  const visitor = wristbands[0] ?? directUsers[0];
  if (!visitor) return c.json({ enabled: false, areas: [], stampedCircleIds: [] });

  const eventRows = await db.select({ stampRallySettings: event.stampRallySettings })
    .from(event).where(eq(event.id, visitor.eventId));
  const settings = parseStampRallySettings(eventRows[0]?.stampRallySettings);
  if (!settings.enabled || settings.areas.length === 0) {
    return c.json({ enabled: false, areas: [], stampedCircleIds: [] });
  }

  const circleIds = [...new Set(settings.areas.flatMap((area) => area.circleIds))];
  const circles = circleIds.length > 0
    ? await db.select({ id: circle.id, name: circle.name, iconImagePath: circle.iconImagePath })
        .from(circle).where(and(
          isNull(circle.deletedAt),
          eq(circle.eventId, visitor.eventId),
        ))
    : [];
  const configuredCircles = new Map(circles.filter((row) => circleIds.includes(row.id)).map((row) => [row.id, row]));
  const completedOrders = circleIds.length > 0
    ? await db.select({ circleId: order.circleId }).from(order).where(and(
        eq(order.userId, visitor.id),
        ne(order.status, "cancelled"),
        or(eq(order.status, "completed"), eq(order.completed, true)),
      ))
    : [];
  const stampedCircleIds = [...new Set(completedOrders.map((row) => row.circleId))]
    .filter((id) => configuredCircles.has(id));
  const stamped = new Set(stampedCircleIds);

  return c.json({
    enabled: true,
    stampedCircleIds,
    areas: settings.areas.map((area) => ({
      ...area,
      circles: area.circleIds.flatMap((id) => {
        const row = configuredCircles.get(id);
        return row ? [{ ...row, stamped: stamped.has(id) }] : [];
      }),
    })),
  });
});

// ユーザーのスタンプ取得
// 2026-07-05: フロント(apps/register, apps/visitor)を grep した結果、現時点では
// `/api/stamps/:userId` を呼び出すコンポーネント・APIラッパーは存在しない(未消費)。
// 想定用途は来場者マイページでの自分のスタンプ確認であり、他のマイページ系エンドポイント
// (例: pre-orders/user/:code)と同様に userId(=リストバンド/ゲストID) の保持自体が
// 実質的な本人確認手段となる設計のため、現状維持（認可なし）とする。
// スタンプ数・景品交換済みフラグのみを返しており、他ユーザーの決済情報等の機微情報は含まない。
stampRoutes.get("/:userId", async (c) => {
  const db = c.get("db");
  const userId = c.req.param("userId");

  // 獲得したスタンプ
  const stamps = await db.select().from(userStamp).where(eq(userStamp.userId, userId));

  // 景品交換履歴
  const redemptions = await db
    .select()
    .from(rewardRedemption)
    .where(eq(rewardRedemption.userId, userId));

  return c.json({
    stamps,
    isRedeemed: redemptions.length > 0,
    stampCount: stamps.length,
  });
});

// 景品引換
stampRoutes.post(
  "/redeem",
  zBody(
    z.object({
      userId: z.string(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const input = c.req.valid("json");

    // 交換処理を行うにはスタッフ以上のログインが必要
    const session = await getSession(c);
    
    if (!session || !session.user) {
      apiError("FORBIDDEN", "権限がありません（スタッフログインが必要です）");
    }

    const staffId = session.user.id || session.user.email;

    // 既に交換済みかチェック
    const existing = await db
      .select()
      .from(rewardRedemption)
      .where(eq(rewardRedemption.userId, input.userId));

    if (existing.length > 0) {
      apiError("BAD_REQUEST", "既に景品を交換済みです");
    }

    // 必要スタンプ数を満たしているかチェック
    const stamps = await db
      .select()
      .from(userStamp)
      .where(eq(userStamp.userId, input.userId));

    if (stamps.length < REQUIRED_STAMP_COUNT) {
      apiError("BAD_REQUEST", "スタンプが足りません");
    }

    // 引換記録を作成
    await db.insert(rewardRedemption).values({
      id: ulid(),
      userId: input.userId,
      staffId: staffId,
    });

    return c.json({ success: true }, 201);
  }
);

export default stampRoutes;
