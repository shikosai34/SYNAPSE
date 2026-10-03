import type { OrderWithItems } from "@/lib/api";

export interface CircleSalesOrders {
  circleId: string;
  circleName: string;
  orders: OrderWithItems[];
}

// 2026-10-03: 売上タブの明示表示時だけ呼び、サークル数分の同時通信を4本に抑える。
// 一部取得失敗を売上ゼロに変換すると誤集計になるため、失敗は ErrorState まで伝える。
export async function loadCircleSalesOrders(
  circles: { id: string; name: string }[],
  listOrders: (circleId: string) => Promise<OrderWithItems[]>,
): Promise<CircleSalesOrders[]> {
  const results: CircleSalesOrders[] = new Array(circles.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < circles.length) {
      const index = next++;
      const circle = circles[index]!;
      try {
        results[index] = { circleId: circle.id, circleName: circle.name, orders: await listOrders(circle.id) };
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, circles.length) }, worker));
  return results;
}
