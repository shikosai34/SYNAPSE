import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { wristbandApi } from "@/lib/api";
import { saveVisitor } from "@/hooks/useVisitor";
import Loader from "@/components/loader";

/**
 * リストバンド入場 (/w/:id) (2026-07-04)。
 *
 * リストバンドのQRは `https://<visitor>/w/<短ID>` を指す。ここで短IDを
 * サーバに照会して eventUser を解決し、来場者セッションを確立する。
 * 未オンボーディング(ニックネーム未登録)なら /visitor/onboarding、済なら /visitor/mypage へ。
 */
export default function Entry() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  // StrictMode と再試行で同じパスが重複実行されず、ID変更時は新しい照会を許可する。
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    const attemptKey = `${id}:${retryCount}`;
    if (startedFor.current === attemptKey) return;
    startedFor.current = attemptKey;

    (async () => {
      if (!id) {
        setError("リストバンドコードが指定されていません");
        return;
      }
      try {
        const res = await wristbandApi.lookup(id);
        const user = res.user;
        const onboarded = !!user.onboardedAt;
        saveVisitor({
          userId: user.id,
          wristbandId: res.wristband?.id ?? id,
          eventId: user.eventId ?? null,
          displayId: user.displayId ?? null,
          nickname: user.nickname ?? null,
          onboarded,
        });
        navigate(onboarded ? "/visitor/mypage" : "/visitor/onboarding", { replace: true });
      } catch (e: any) {
        setError(e?.message || "入場に失敗しました。もう一度お試しください。");
      }
    })();
  }, [id, navigate, retryCount]);

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center font-mono">
        <h1 className="text-2xl font-black uppercase tracking-wider">入場エラー</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
        <button
          onClick={() => {
            setError(null);
            // 2026-10-08: 同一URLへのnavigateはeffectを再実行しないため、試行番号で再取得する。
            setRetryCount((count) => count + 1);
          }}
          className="border-[2px] border-border px-4 py-2 text-sm font-bold uppercase hover:bg-primary hover:text-primary-foreground"
        >
          再試行
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 font-mono">
      <Loader />
      <p className="text-sm text-muted-foreground">入場処理中...</p>
    </div>
  );
}
