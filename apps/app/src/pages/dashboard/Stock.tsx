import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAuthGuard } from "@/hooks/useCircleAuth";
import { menuApi, type Menu } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "sonner";
import { AlertTriangle, Package, Search, Plus, Minus, XCircle, RotateCcw, Coins } from "lucide-react";

const DEFAULT_LOW = 10;

// 在庫数の直接入力 (2026-07-15)。
// 従来は onChange のたびに updateStock.mutate を叩いており、1文字打つごとに
// サーバ更新→再取得が走って value がサーバ値に巻き戻り「入力が不安定」だった。
// ローカルの下書き状態で自由に編集させ、確定(blur / Enter)時にだけ親へ通知する。
// 編集中は空欄も許容し、数字以外は無視する。
function StockQtyInput({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(value));

  // 外部(サーバ)値が変わったら、非編集時に追従させる
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Math.max(0, Math.trunc(Number(draft)));
    if (draft.trim() === "" || Number.isNaN(Number(draft))) {
      setDraft(String(value)); // 不正入力は元に戻す
      return;
    }
    setDraft(String(n));
    onCommit(n);
  };

  return (
    <Input
      type="number"
      inputMode="numeric"
      className="w-16 border-thick border-border rounded-none h-7 text-xs bg-background focus-visible:ring-0 text-center tabular-nums"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// 在庫管理 (拡張機能)。2026-07-14 に大幅拡充: サマリ(品目/売切/僅少/在庫数/在庫金額)、
// クイック増減(±1/±5/±10)、売切・再開のワンタップ、僅少しきい値(端末保存)、検索、要対応フィルタ。
function StockManagementContent() {
  const [circleId, setCircleId] = useState<string>("");
  const [circleName, setCircleName] = useState<string>("サークルダッシュボード");
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  // 僅少しきい値。サークル設定は circle:write が必要でスタッフが変更できないため、端末(localStorage)に保存する。
  const [lowThreshold, setLowThreshold] = useState<number>(DEFAULT_LOW);

  useEffect(() => {
    const storedCircleId = localStorage.getItem("circleId");
    if (storedCircleId) setCircleId(storedCircleId);
    const authStored = localStorage.getItem("circleAuth");
    if (authStored) {
      try {
        const authInfo = JSON.parse(authStored);
        if (authInfo.circleName) setCircleName(authInfo.circleName);
      } catch (_) {}
    }
  }, []);

  // しきい値を circle 単位で端末保存
  useEffect(() => {
    if (!circleId) return;
    const saved = localStorage.getItem(`lowStock:${circleId}`);
    if (saved) setLowThreshold(Number(saved) || DEFAULT_LOW);
  }, [circleId]);
  const updateThreshold = (n: number) => {
    const v = Math.max(0, n);
    setLowThreshold(v);
    if (circleId) localStorage.setItem(`lowStock:${circleId}`, String(v));
  };

  const { data: menus, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["menus", circleId],
    queryFn: () => menuApi.list(circleId),
    enabled: !!circleId,
  });

  // 在庫の絶対値更新 (レジ在庫API。stock>0 で soldOut は自動解除される)
  const updateStock = useMutation({
    mutationFn: (input: { id: string; stock: number }) => menuApi.updateStock(input.id, input.stock),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menus", circleId] });
    },
    onError: (e: any) => toast.error(e?.message || "在庫の更新に失敗しました"),
  });

  // 売切/再開の明示切替 (在庫数に依らず soldOut を直接操作)
  const toggleSoldOut = useMutation({
    mutationFn: (m: Menu) => menuApi.update(m.id, { soldOut: !m.soldOut }),
    onSuccess: (_d, m) => {
      toast.success(m.soldOut ? "販売を再開しました" : "売り切れにしました");
      queryClient.invalidateQueries({ queryKey: ["menus", circleId] });
    },
    onError: (e: any) => toast.error(e?.message || "更新に失敗しました"),
  });

  const adjust = (m: Menu, delta: number) => {
    const next = Math.max(0, (m.stockQuantity ?? 0) + delta);
    updateStock.mutate({ id: m.id, stock: next });
  };

  const isRowPending = (id: string) =>
    (updateStock.isPending && updateStock.variables?.id === id) ||
    (toggleSoldOut.isPending && toggleSoldOut.variables?.id === id);

  // 集計サマリ
  const summary = useMemo(() => {
    const list = menus ?? [];
    let units = 0;
    let value = 0;
    let soldOut = 0;
    let low = 0;
    for (const m of list) {
      const q = m.stockQuantity ?? 0;
      units += q;
      value += q * m.price;
      if (m.soldOut) soldOut += 1;
      else if (q <= lowThreshold) low += 1;
    }
    return { total: list.length, units, value, soldOut, low };
  }, [menus, lowThreshold]);

  // 並べ替え(売切→僅少→通常, 同レベルは名前順) + 検索/要対応フィルタ
  const shown = useMemo(() => {
    let list = menus ?? [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q));
    }
    if (onlyIssues) {
      list = list.filter((m) => m.soldOut || (m.stockQuantity ?? 0) <= lowThreshold);
    }
    const rank = (m: Menu) => (m.soldOut ? 0 : (m.stockQuantity ?? 0) <= lowThreshold ? 1 : 2);
    return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ja"));
  }, [menus, search, onlyIssues, lowThreshold]);

  if (isLoading) {
    return (
      <DashboardLayout title={circleName} subtitle="在庫管理" type="circle">
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      </DashboardLayout>
    );
  }
  if (isError) {
    return (
      <DashboardLayout title={circleName} subtitle="在庫管理" type="circle">
        <ErrorState error={error} onRetry={() => refetch()} />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={circleName} subtitle="在庫管理" type="circle">
      <div className="space-y-5 font-mono text-foreground">
        {/* サマリ */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { label: "品目数", value: `${summary.total}`, cls: "" },
            { label: "売り切れ", value: `${summary.soldOut}`, cls: summary.soldOut > 0 ? "text-error" : "" },
            { label: "在庫僅少", value: `${summary.low}`, cls: summary.low > 0 ? "text-warning" : "" },
            { label: "在庫総数", value: `${summary.units}個`, cls: "" },
            { label: "在庫金額", value: `¥${summary.value.toLocaleString()}`, cls: "" },
          ].map((s) => (
            <div key={s.label} className="border-thick border-border bg-background p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</div>
              <div className={`font-headline text-[22px] leading-none tabular-nums mt-1 ${s.cls}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ツールバー: 検索 / 要対応 / しきい値 */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="メニュー名で検索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 border-thick border-border rounded-none h-9 text-xs bg-background focus-visible:ring-0"
            />
          </div>
          <button
            type="button"
            onClick={() => setOnlyIssues((v) => !v)}
            className={`font-mono text-[11px] uppercase border-thick px-3 h-9 shrink-0 ${
              onlyIssues ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-muted"
            }`}
          >
            要対応のみ
          </button>
          <div className="flex items-center gap-1.5 border-thick border-border px-2 h-9 shrink-0">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            <span className="text-[10px] uppercase text-muted-foreground">僅少≤</span>
            <input
              type="number"
              min={0}
              value={lowThreshold}
              onChange={(e) => updateThreshold(Number(e.target.value))}
              className="w-12 bg-transparent text-xs text-center focus:outline-none tabular-nums"
            />
          </div>
        </div>

        {/* 低在庫アラート */}
        {summary.soldOut + summary.low > 0 && !onlyIssues && (
          <Card className="border-warning rounded-none shadow-none">
            <CardHeader className="pb-2 border-b-thin border-border">
              <CardTitle className="flex items-center text-warning text-xs font-bold uppercase">
                <AlertTriangle className="mr-2 h-4 w-4" />
                要対応 {summary.soldOut + summary.low} 品 (売切 {summary.soldOut} / 僅少 {summary.low})
              </CardTitle>
            </CardHeader>
          </Card>
        )}

        {/* 在庫一覧 */}
        <Card className="rounded-none shadow-none">
          <CardHeader className="pb-2 border-b-thick border-border">
            <CardTitle className="flex items-center text-sm font-bold uppercase">
              <Package className="mr-2 h-4 w-4" />
              在庫一覧
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {shown.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={Package} message={onlyIssues || search ? "該当するメニューはありません" : "メニューがありません"} />
              </div>
            ) : (
              <div className="divide-y divide-border">
                {shown.map((m) => {
                  const q = m.stockQuantity ?? 0;
                  const level = m.soldOut ? "out" : q <= lowThreshold ? "low" : "ok";
                  const pending = isRowPending(m.id);
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-wrap items-center gap-3 p-3 text-xs ${
                        level === "out" ? "bg-error/5" : level === "low" ? "bg-warning/5" : ""
                      }`}
                    >
                      <div className="relative h-11 w-11 overflow-hidden shrink-0 border-thick border-border">
                        {m.imagePath ? (
                          <img src={m.imagePath} alt={m.name} className={`absolute inset-0 h-full w-full object-cover ${m.soldOut ? "opacity-40" : ""}`} />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-muted">
                            <span className="text-[8px] text-muted-foreground">No Image</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-grow min-w-[120px]">
                        <p className="font-bold text-foreground truncate">{m.name}</p>
                        <p className="text-[10px] text-muted-foreground">¥{m.price.toLocaleString()}</p>
                      </div>

                      {/* 状態バッジ */}
                      <div className="shrink-0 w-16 text-right tabular-nums">
                        {level === "out" ? (
                          <span className="text-error font-bold">売切</span>
                        ) : level === "low" ? (
                          <span className="text-warning font-bold flex items-center justify-end gap-1"><AlertTriangle className="h-3 w-3" />残{q}</span>
                        ) : (
                          <span className="text-muted-foreground">残{q}</span>
                        )}
                      </div>

                      {/* クイック増減 */}
                      <div className="flex items-center gap-1 shrink-0">
                        {[-10, -5, -1].map((d) => (
                          <button key={d} type="button" disabled={pending || q + d < 0} onClick={() => adjust(m, d)}
                            className="border-thick border-border h-7 w-8 text-[10px] font-bold hover:bg-destructive hover:text-white disabled:opacity-30">
                            {d}
                          </button>
                        ))}
                        <StockQtyInput
                          value={q}
                          disabled={pending}
                          onCommit={(v) => {
                            if (v !== q) updateStock.mutate({ id: m.id, stock: v });
                          }}
                        />
                        {[1, 5, 10].map((d) => (
                          <button key={d} type="button" disabled={pending} onClick={() => adjust(m, d)}
                            className="border-thick border-border h-7 w-8 text-[10px] font-bold hover:bg-success hover:text-white disabled:opacity-30">
                            +{d}
                          </button>
                        ))}
                      </div>

                      {/* 売切 / 再開 */}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => toggleSoldOut.mutate(m)}
                        className={`shrink-0 border-thick h-7 px-2 text-[10px] font-bold uppercase flex items-center gap-1 disabled:opacity-40 ${
                          m.soldOut
                            ? "border-success text-success hover:bg-success hover:text-white"
                            : "border-destructive text-destructive hover:bg-destructive hover:text-white"
                        }`}
                      >
                        {m.soldOut ? (<><RotateCcw className="h-3 w-3" />再開</>) : (<><XCircle className="h-3 w-3" />売切</>)}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Coins className="h-3 w-3" />
          在庫は注文が入ると自動的に減り、0 になると自動で売り切れになります。±ボタンや数値入力で補充・調整できます。
        </p>
      </div>
    </DashboardLayout>
  );
}

export default function StockManagementPage() {
  return (
    <CircleAuthGuard>
      <StockManagementContent />
    </CircleAuthGuard>
  );
}
