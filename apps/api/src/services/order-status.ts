import type { WorkerEnv } from "@fesflow/db";

type D1 = WorkerEnv["DB"];

/**
 * 2026-10-03: status変更を期待する旧状態で条件更新し、スタンプ付与も同じD1 batchにまとめる。
 * 旧状態の読取後に別リクエストが先行した場合は上書きせず、D1呼出しを1往復に保つ。
 */
export async function updateOrderStatus(
  db: D1,
  input: {
    orderId: string;
    expectedStatus: string;
    nextStatus: string;
    stamp?: { id: string; userId: string; circleId: string };
  },
): Promise<boolean> {
  const statements = [
    db.prepare("UPDATE orders SET status=? WHERE id=? AND status=?")
      .bind(input.nextStatus, input.orderId, input.expectedStatus),
  ];

  if (input.stamp) {
    statements.push(
      db.prepare(`INSERT INTO user_stamp (id,user_id,circle_id)
        SELECT ?,?,? WHERE changes()=1
        ON CONFLICT(user_id,circle_id) DO NOTHING`)
        .bind(input.stamp.id, input.stamp.userId, input.stamp.circleId),
    );
  }

  const results = await db.batch(statements);
  return results[0]?.meta.changes === 1;
}
