import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { lotteryApi, type LotteryData, type LotteryEntryConfig } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Ticket, Gift, Trophy, Trash2, Dices, Save, Check } from "lucide-react";

// イベント単位の抽選管理 (2026-07-12)
// 主催者が景品と口数(当選確率)の重みを設定し、応募者から重み付き抽選する。
// 口数 = base + perStamp*スタンプ数 + perReview*レビュー数。
export function LotteryTab({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["lottery", eventId] });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["lottery", eventId],
    queryFn: () => lotteryApi.get(eventId),
    enabled: !!eventId,
  });

  const [name, setName] = useState("お楽しみ抽選会");
  const [drawAt, setDrawAt] = useState("");
  const [cfg, setCfg] = useState<LotteryEntryConfig>({ base: 1, perStamp: 0, perReview: 0 });
  const [prizeName, setPrizeName] = useState("");
  const [prizeQty, setPrizeQty] = useState(1);
  const [confirmDraw, setConfirmDraw] = useState(false);

  useEffect(() => {
    if (data?.lottery) {
      setName(data.lottery.name);
      setDrawAt(data.lottery.drawAt ? String(data.lottery.drawAt).slice(0, 16) : "");
      setCfg(data.lottery.entryConfig);
    }
  }, [data?.lottery]);

  const save = useMutation({
    mutationFn: () =>
      lotteryApi.upsert({ eventId, name: name.trim(), drawAt: drawAt || undefined, entryConfig: cfg }),
    onSuccess: () => { toast.success("抽選を保存しました"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "保存に失敗しました"),
  });
  const lot = data?.lottery;
  const addPrize = useMutation({
    mutationFn: () => lotteryApi.addPrize(lot!.id, { name: prizeName.trim(), quantity: prizeQty }),
    onSuccess: () => { toast.success("景品を追加しました"); setPrizeName(""); setPrizeQty(1); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "追加に失敗しました"),
  });
  const delPrize = useMutation({
    mutationFn: (prizeId: string) => lotteryApi.deletePrize(lot!.id, prizeId),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.message || "削除に失敗しました"),
  });
  const draw = useMutation({
    mutationFn: () => lotteryApi.draw(lot!.id),
    onSuccess: (r) => { toast.success(`抽選を実行しました (${r.drawn}名当選)`); setConfirmDraw(false); invalidate(); },
    onError: (e: any) => { toast.error(e?.message || "抽選に失敗しました"); setConfirmDraw(false); },
  });
  const claim = useMutation({
    mutationFn: (winnerId: string) => lotteryApi.claim(lot!.id, winnerId),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.message || "受取記録に失敗しました"),
  });

  if (isLoading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;

  const d: LotteryData = data!;
  const drawn = lot?.status === "drawn";

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="border-b-thick border-border pb-3">
        <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
          <Ticket className="h-4 w-4" /> 抽選
        </h2>
        <p className="text-[11px] text-muted-foreground font-mono mt-1">
          景品と口数(当選確率)の重みを設定し、応募者から抽選します。口数 = 基本 + スタンプ×係数 + レビュー×係数。
        </p>
      </div>

      {/* 設定 */}
      <section className="space-y-3 border-thick border-border p-3">
        <div className="space-y-1">
          <Label htmlFor="lot-name">抽選名</Label>
          <Input id="lot-name" value={name} onChange={(e) => setName(e.target.value)} disabled={drawn} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lot-draw">当選発表時刻 (任意)</Label>
          <Input id="lot-draw" type="datetime-local" value={drawAt} onChange={(e) => setDrawAt(e.target.value)} disabled={drawn} className="w-56" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label>基本口数</Label>
            <Input type="number" min={0} value={cfg.base} onChange={(e) => setCfg({ ...cfg, base: Number(e.target.value) || 0 })} disabled={drawn} />
          </div>
          <div className="space-y-1">
            <Label>スタンプ係数</Label>
            <Input type="number" min={0} value={cfg.perStamp} onChange={(e) => setCfg({ ...cfg, perStamp: Number(e.target.value) || 0 })} disabled={drawn} />
          </div>
          <div className="space-y-1">
            <Label>レビュー係数</Label>
            <Input type="number" min={0} value={cfg.perReview} onChange={(e) => setCfg({ ...cfg, perReview: Number(e.target.value) || 0 })} disabled={drawn} />
          </div>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          例: 基本1/スタンプ0/レビュー0 = 応募者全員1口の等確率。基本0/スタンプ1 = スタンプ数がそのまま口数。
        </p>
        {!drawn && (
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
            <Save className="h-4 w-4 mr-1.5" /> {lot ? "設定を保存" : "抽選を作成"}
          </Button>
        )}
      </section>

      {lot && (
        <>
          {/* 景品 */}
          <section className="space-y-3">
            <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Gift className="h-3.5 w-3.5" /> 景品 (応募 {d.entryCount ?? 0} 名)
            </h3>
            <div className="space-y-1">
              {(d.prizes ?? []).map((p) => (
                <div key={p.id} className="flex items-center justify-between border-thin border-border p-2 font-mono text-[12px]">
                  <span>{p.name} <span className="text-muted-foreground">×{p.quantity}</span></span>
                  {!drawn && (
                    <button onClick={() => delPrize.mutate(p.id)} className="text-muted-foreground hover:text-error">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {(d.prizes ?? []).length === 0 && <p className="font-mono text-[11px] text-muted-foreground">景品がありません。</p>}
            </div>
            {!drawn && (
              <div className="flex gap-2 items-end">
                <div className="space-y-1 flex-1">
                  <Label htmlFor="prize-name">景品名</Label>
                  <Input id="prize-name" value={prizeName} onChange={(e) => setPrizeName(e.target.value)} placeholder="例: 図書カード500円" />
                </div>
                <div className="space-y-1 w-24">
                  <Label htmlFor="prize-qty">当選数</Label>
                  <Input id="prize-qty" type="number" min={1} value={prizeQty} onChange={(e) => setPrizeQty(Math.max(1, Number(e.target.value) || 1))} />
                </div>
                <Button variant="outline" onClick={() => addPrize.mutate()} disabled={addPrize.isPending || !prizeName.trim()}>追加</Button>
              </div>
            )}
          </section>

          {/* 抽選実行 / 当選者 */}
          <section className="space-y-3">
            {!drawn ? (
              <Button
                onClick={() => setConfirmDraw(true)}
                disabled={draw.isPending || (d.prizes ?? []).length === 0 || (d.entryCount ?? 0) === 0}
                className="w-full"
                size="lg"
              >
                <Dices className="h-4 w-4 mr-1.5" /> 抽選を実行する
              </Button>
            ) : (
              <>
                <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Trophy className="h-3.5 w-3.5" /> 当選者 ({d.winners?.length ?? 0})
                </h3>
                <div className="space-y-1">
                  {(d.winners ?? []).map((w) => (
                    <div key={w.id} className="flex items-center justify-between border-thin border-border p-2 font-mono text-[12px]">
                      <span>
                        <span className="font-bold">{w.userLabel}</span>
                        <span className="text-muted-foreground"> — {w.prizeName}</span>
                      </span>
                      {w.claimedAt ? (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Check className="h-3.5 w-3.5" /> 受取済</span>
                      ) : (
                        <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => claim.mutate(w.id)}>受取記録</Button>
                      )}
                    </div>
                  ))}
                  {(d.winners ?? []).length === 0 && <p className="font-mono text-[11px] text-muted-foreground">当選者がいません。</p>}
                </div>
              </>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        isOpen={confirmDraw}
        title="[確認: 抽選の実行]"
        description="抽選を実行すると当選者が確定し、設定・景品は変更できなくなります。よろしいですか？"
        confirmLabel="抽選を実行"
        isPending={draw.isPending}
        onConfirm={() => draw.mutate()}
        onCancel={() => setConfirmDraw(false)}
      />
    </div>
  );
}
