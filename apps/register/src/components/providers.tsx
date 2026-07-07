import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";
import { useState } from "react";
import { handleApiErrorToast } from "@/lib/api-error";

export default function Providers({ children }: { children: React.ReactNode }) {
  // 2026-07-06: 例外は必ずトーストで可視化する。
  // - クエリ失敗: 従来サイレントだったのでグローバルにトースト (id 固定で連投を抑制)。
  // - ミューテーション失敗: 独自 onError を持たないものだけグローバルにトースト
  //   (二重トースト防止)。
  // 2026-07-07 (Phase4): トースト一辺倒から ApiError.code による UX 分岐
  // (401→ログイン誘導 / 403→権限メッセージ / 429→再試行秒数 / VALIDATION→fields) に変更。
  // handleApiErrorToast (lib/api-error.ts) に集約し、ここでは呼ぶだけにする。
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            handleApiErrorToast(error, { toastId: "query-error" });
          },
        }),
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            if (!mutation.options.onError) {
              handleApiErrorToast(error);
            }
          },
        }),
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {children}
        <ReactQueryDevtools />
      </ThemeProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
