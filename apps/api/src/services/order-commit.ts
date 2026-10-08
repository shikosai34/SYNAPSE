import type { WorkerEnv } from "@fesflow/db";
import { ulid } from "ulidx";
import { apiError } from "../http-error";

type D1 = WorkerEnv["DB"];
export type OrderCommand = { key: string; fingerprint: string };
export type CommittedOrder = { id: string; orderNumber: string };
type Line = {
  menuId: string; menuName: string; menuPrice: number; quantity: number;
  inventoryEnabled: boolean;
  toppings: { toppingId: string; toppingName: string; toppingPrice: number }[];
};
type CommitOrderInputBase = {
  id: string; circleId: string; userId: string; cashierId?: string;
  peopleCount: number; totalPrice: number; paymentMethod?: string;
  status: "pending" | "preparing" | "completed";
  items: Line[];
};
// 2026-10-08 (#49): claimのCAS tokenをpreOrderIdと必ず対にし、D1へundefinedをbindできないよう型で制約する。
export type CommitOrderInput = CommitOrderInputBase & (
  | { preOrderId: string; expectedPreOrderUpdatedAt: number }
  | { preOrderId?: undefined; expectedPreOrderUpdatedAt?: undefined }
);

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// 2026-10-03 (#82): キーを来場者/サークルで分離し、内容変更でのキー再利用は409にする。
// 生のクライアントキーや要求内容を永続化せずハッシュだけを保存する。
export async function orderCommand(scope: string, key: string | undefined, input: unknown): Promise<OrderCommand> {
  if (key !== undefined && (key.length < 1 || key.length > 128)) {
    apiError("VALIDATION", "Idempotency-Keyは1〜128文字で指定してください");
  }
  return { key: await digest(`${scope}\0${key ?? crypto.randomUUID()}`), fingerprint: await digest(JSON.stringify(input)) };
}

export async function committedOrder(db: D1, command: OrderCommand): Promise<CommittedOrder | null> {
  const row = await db.prepare(`SELECT o.id, o.order_number AS orderNumber, c.fingerprint
    FROM order_commit c JOIN orders o ON o.id = c.order_id WHERE c.key = ?`)
    .bind(command.key).first<CommittedOrder & { fingerprint: string }>();
  if (!row) return null;
  if (row.fingerprint !== command.fingerprint) apiError("CONFLICT", "同じ注文キーで内容を変更することはできません");
  return { id: row.id, orderNumber: row.orderNumber };
}

// 2026-10-03 (#81): 採番日と旧番号の検索範囲はJST営業日を正本にそろえる。
export function jstOrderDay(now: number): { day: string; dayStart: number } {
  const day = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll("-", "");
  const dayStart = Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T00:00:00+09:00`);
  return { day, dayStart };
}

/**
 * 2026-10-03 (#81/#82): D1 batchの1トランザクションに業務ガード・採番・在庫・明細を含める。
 * UPDATE 0行はSQLエラーにならないため、CHECKガードで失敗をrollbackへ変換する。
 * json_eachで可変長入力を1パラメータにし、品目数に比例したSQL/バインドを発行しない。
 * 呼出元は認可・価格・クーポンを検証する。ここでは確定直前の状態/在庫を再検証する。
 */
export async function commitOrder(db: D1, command: OrderCommand, input: CommitOrderInput): Promise<CommittedOrder> {
  if (!input.items.length) apiError("BAD_REQUEST", "商品が含まれていません");
  const now = Date.now();
  const { day, dayStart } = jstOrderDay(now);
  const scope = `${input.circleId}:${day}`;
  const shortCirclePrefix = input.circleId.slice(0, 4);
  const orderNumberPrefix = `${shortCirclePrefix}-${day}-`;
  const legacyOrderNumberPrefix = `${shortCirclePrefix}-${day.slice(4)}-`;
  const items = input.items.map((item) => ({ ...item, id: ulid() }));
  const menuQuantities = new Map<string, number>();
  const inventoryQuantities = new Map<string, number>();
  const toppingQuantities = new Map<string, number>();
  for (const item of items) {
    menuQuantities.set(item.menuId, (menuQuantities.get(item.menuId) ?? 0) + item.quantity);
    if (item.inventoryEnabled) inventoryQuantities.set(item.menuId, (inventoryQuantities.get(item.menuId) ?? 0) + item.quantity);
    for (const top of item.toppings) toppingQuantities.set(top.toppingId, (toppingQuantities.get(top.toppingId) ?? 0) + item.quantity);
  }
  const needs = (values: Map<string, number>) => JSON.stringify([...values].map(([id, quantity]) => ({ id, quantity })));
  const menus = needs(menuQuantities);
  const inventoryMenus = needs(inventoryQuantities);
  const toppings = needs(toppingQuantities);
  const itemJson = JSON.stringify(items);
  const toppingJson = JSON.stringify(items.flatMap((item) => item.toppings.map((top) => ({ ...top, id: ulid(), orderItemId: item.id }))));
  const statements = [
    db.prepare(`INSERT INTO order_write_guard (id, valid) SELECT ?, CASE WHEN
      EXISTS (SELECT 1 FROM circle c JOIN event e ON e.id=c.event_id JOIN event_user u ON u.event_id=e.id
        WHERE c.id=? AND c.deleted_at IS NULL AND u.id=? AND u.status!='banned'
        AND e.deleted_at IS NULL AND e.lifecycle_status='live' AND e.billing_status!='suspended'
        AND (e.end_date IS NULL OR e.end_date>=?))
      AND NOT EXISTS (SELECT 1 FROM json_each(?) j LEFT JOIN menu m ON m.id=json_extract(j.value,'$.id')
        WHERE m.id IS NULL OR m.circle_id!=? OR m.sold_out=1
        OR (m.inventory_enabled=1 AND m.stock_quantity<json_extract(j.value,'$.quantity')))
      AND NOT EXISTS (SELECT 1 FROM json_each(?) j LEFT JOIN topping t ON t.id=json_extract(j.value,'$.id')
        WHERE t.id IS NULL OR t.circle_id!=? OR t.sold_out=1
        OR (t.stock_quantity>0 AND t.stock_quantity<json_extract(j.value,'$.quantity')))
      AND (? IS NULL OR EXISTS (SELECT 1 FROM pre_order WHERE id=? AND circle_id=? AND user_id=?
        AND status='pending' AND updated_at=?))
      THEN 1 ELSE 0 END`).bind(input.id, input.circleId, input.userId, now, menus, input.circleId,
        toppings, input.circleId, input.preOrderId ?? null, input.preOrderId ?? null, input.circleId, input.userId,
        input.expectedPreOrderUpdatedAt ?? null),
    // 2026-10-03 (#81): 表示番号は店舗内の連番で十分なため、共有グローバル連番の競合書込みをなくす。
    // 年を表示に含めて店舗内の番号検索を一意に保ち、初回実行時は同じJST営業日の旧形式番号から続ける。
    db.prepare(`INSERT INTO order_sequence (scope,value)
      VALUES (?, COALESCE((SELECT MAX(CASE WHEN order_number>=? AND order_number<?
        THEN CAST(substr(order_number,length(?)+1) AS INTEGER)
        ELSE CAST(substr(order_number,length(?)+1) AS INTEGER) END)
        FROM orders WHERE circle_id=? AND ((order_number>=? AND order_number<?)
          OR (order_number>=? AND order_number<?)) AND created_at>=? AND created_at<?),0) + 1)
      ON CONFLICT(scope) DO UPDATE SET value=value+1`)
      .bind(scope, orderNumberPrefix, `${orderNumberPrefix}:`, orderNumberPrefix, legacyOrderNumberPrefix,
        input.circleId, orderNumberPrefix, `${orderNumberPrefix}:`, legacyOrderNumberPrefix, `${legacyOrderNumberPrefix}:`,
        dayStart, dayStart + 24 * 60 * 60 * 1000),
    db.prepare(`INSERT INTO orders (id,circle_id,user_id,cashier_id,order_number,people_count,total_price,status,payment_method,completed,completed_at)
      SELECT ?,?,?,?,? || printf('%03d',daily.value),?,?,?,?,?,?
      FROM order_sequence daily WHERE daily.scope=?
      RETURNING id,order_number AS orderNumber`)
      .bind(input.id, input.circleId, input.userId, input.cashierId ?? null, orderNumberPrefix,
        input.peopleCount, input.totalPrice, input.status, input.paymentMethod ?? null,
        input.status === "completed" ? 1 : 0, input.status === "completed" ? now : null, scope),
    db.prepare(`INSERT INTO order_item (id,order_id,menu_id,menu_name,menu_price,quantity)
      SELECT json_extract(value,'$.id'),?,json_extract(value,'$.menuId'),json_extract(value,'$.menuName'),
      json_extract(value,'$.menuPrice'),json_extract(value,'$.quantity') FROM json_each(?)`).bind(input.id, itemJson),
  ];
  // 2026-10-03: 在庫管理対象がない注文は、0行更新になるメニュー在庫SQL自体をbatchから省く。
  if (inventoryMenus !== "[]") statements.push(db.prepare(`UPDATE menu SET
    sold_out=CASE WHEN stock_quantity=(SELECT json_extract(value,'$.quantity') FROM json_each(?) WHERE json_extract(value,'$.id')=menu.id) THEN 1 ELSE sold_out END,
    stock_quantity=stock_quantity-(SELECT json_extract(value,'$.quantity') FROM json_each(?) WHERE json_extract(value,'$.id')=menu.id),updated_at=?
    WHERE inventory_enabled=1 AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`)
    .bind(inventoryMenus, inventoryMenus, now, inventoryMenus));
  // 2026-10-03: トッピングなしの注文では空集合へのINSERT/UPDATEをD1 batchから外す。
  if (toppingJson !== "[]") {
    statements.push(db.prepare(`INSERT INTO order_item_topping (id,order_item_id,topping_id,topping_name,topping_price)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.orderItemId'),json_extract(value,'$.toppingId'),
      json_extract(value,'$.toppingName'),json_extract(value,'$.toppingPrice') FROM json_each(?)`).bind(toppingJson));
    statements.push(db.prepare(`UPDATE topping SET
      sold_out=CASE WHEN stock_quantity=(SELECT json_extract(value,'$.quantity') FROM json_each(?) WHERE json_extract(value,'$.id')=topping.id) THEN 1 ELSE sold_out END,
      stock_quantity=stock_quantity-(SELECT json_extract(value,'$.quantity') FROM json_each(?) WHERE json_extract(value,'$.id')=topping.id),updated_at=?
      WHERE stock_quantity>0 AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`).bind(toppings, toppings, now, toppings));
  }
  if (input.preOrderId) {
    // 2026-10-07 Issue #49: cashier は読取時の draft updated_at をCASし、後着autosaveとの順序を確定する。
    statements.push(db.prepare(`UPDATE pre_order SET status='completed',updated_at=MAX(updated_at+1,?)
      WHERE id=? AND status='pending' AND updated_at=?`).bind(now, input.preOrderId, input.expectedPreOrderUpdatedAt));
  }
  if (input.status !== "pending") statements.push(db.prepare(`INSERT INTO user_stamp (id,user_id,circle_id)
    SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM user_stamp WHERE user_id=? AND circle_id=?)`)
    .bind(ulid(), input.userId, input.circleId, input.userId, input.circleId));
  statements.push(db.prepare("INSERT INTO order_commit (key,fingerprint,order_id) VALUES (?,?,?)").bind(command.key, command.fingerprint, input.id));
  statements.push(db.prepare("DELETE FROM order_write_guard WHERE id=?").bind(input.id));
  try {
    const result = await db.batch(statements);
    return result[2]!.results[0] as unknown as CommittedOrder;
  } catch (error) {
    // 同じキーの並行要求で負けたbatchは全てrollback済み。確定した勝者の結果を返す。
    const winner = await committedOrder(db, command);
    if (winner) return winner;
    const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : "";
    if (message.includes("order_write_guard_valid")) apiError("BAD_REQUEST", "在庫または受付状態が変わりました。商品とイベントの状態を確認してください");
    throw error;
  }
}
