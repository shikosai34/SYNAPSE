
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";
import { useState } from "react";
import { handleApiErrorToast } from "@/lib/api-error";

export default function Providers({ children }: { children: React.ReactNode }) {
  // 2026-07-07 (Phase4): 従来は QueryCache/MutationCache に onError が無く、失敗が
  // サイレントになっていた。register と同様に統一エラーハンドラ (handleApiErrorToast)
  // を通す。ただし visitor はログイン画面を持たないため 401 の誘導は行わない
  // (lib/api-error.ts 側の分岐を参照)。
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
      <Toaster richColors />
    </QueryClientProvider>
  );
}

