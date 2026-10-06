import { useEffect, useState } from "react";
import type { CreateOrderInput } from "@fesflow/config/order-contract";
import { orderApi } from "@/lib/api";
import { createOrderSubmission, orderFingerprint } from "./submission";

// 2026-10-03: カート・来場者・サークル・支払方法の変更は別の会計として扱う。
export function useOrderSubmission(input: CreateOrderInput | null) {
  const [submission] = useState(() => createOrderSubmission(orderApi.create));
  const fingerprint = input ? orderFingerprint(input) : null;
  useEffect(() => submission.observeDraft(fingerprint), [submission, fingerprint]);
  return submission.submit;
}
