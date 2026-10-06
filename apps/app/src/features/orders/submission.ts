import type { CreateOrderInput, CreateOrderResult } from "@fesflow/config/order-contract";

// 2026-10-03: 通信断でサーバの完了応答だけを失っても、同じ注文を再送すると同じ結果を得る。
// メモリ内だけに保持し、来場者識別子や注文内容を永続ストレージへ追加保存しない。
export function orderFingerprint(input: CreateOrderInput): string {
  return JSON.stringify({
    circleId: input.circleId, userId: input.userId,
    cashierId: input.cashierId, peopleCount: input.peopleCount ?? 1,
    paymentMethod: input.paymentMethod, notes: input.notes,
    items: input.items.map((item) => ({
      menuId: item.menuId, quantity: item.quantity, toppingIds: [...(item.toppingIds ?? [])].sort(),
    })),
  });
}

export function createOrderSubmission(
  send: (input: CreateOrderInput, idempotencyKey: string) => Promise<CreateOrderResult>,
  newKey: () => string = () => crypto.randomUUID(),
) {
  let draft: string | null = null;
  let attempt: { fingerprint: string; key: string } | null = null;
  let inFlight: Promise<CreateOrderResult> | null = null;

  return {
    observeDraft(fingerprint: string | null) {
      if (draft !== fingerprint) attempt = null;
      draft = fingerprint;
    },
    async submit(input: CreateOrderInput): Promise<CreateOrderResult> {
      // React の再描画前に複数回呼ばれた場合も送信を一本化する。
      if (inFlight) return inFlight;
      const fingerprint = orderFingerprint(input);
      if (!attempt || attempt.fingerprint !== fingerprint) attempt = { fingerprint, key: newKey() };
      const current = attempt;
      inFlight = Promise.resolve().then(() => send(input, current.key));
      try {
        const result = await inFlight;
        // 成功した会計の次は、同一内容でも別の会計として送信できる。
        if (attempt === current) attempt = null;
        return result;
      } finally {
        // 失敗時にはキーもカートも捨てず、利用者が内容を変えずに再試行できる。
        inFlight = null;
      }
    },
  };
}
