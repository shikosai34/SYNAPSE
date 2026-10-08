import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAuthGuard, PermissionGuard, useAuth } from "@/hooks/useCircleAuth";
import { couponApi, menuApi, toppingApi, type Coupon, type CouponKind, type CreateCouponInput } from "@/lib/api";
import { cn } from "@/lib/utils";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/Modal";
import { FormField, FormSubmitButton } from "@/components/ui/FormField";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "sonner";
import { Ticket, Plus, Copy, Ban } from "lucide-react";

// サークル限定クーポン管理 (2026-09-16, issue #50)。
// 「知り合い限定」で使える割引を、サークルが自分たちで作れるようにする画面。
// URL(slug)は推測不能なランダム文字列、合言葉は口頭ではなくテキストで一緒に伝える運用を
// 想定しているため、共有用の文面(URL+合言葉)をまとめてコピーできるボタンを用意している。
// kind (2026-09-16 フィードバック対応): 金額引き(対象メニュー限定) / トッピング無料 の2種類。

const initialForm = {
  kind: "menu_discount" as CouponKind,
  title: "",
  passphrase: "",
  discountAmount: 100,
  // 空欄 = 使用回数無制限 (2026-09-16 フィードバック対応)。
  maxRedemptions: 5 as number | "",
  menuIds: [] as string[],
  toppingIds: [] as string[],
  // 空欄 = 対象トッピングを個数上限なく全部無料にする ("自由度を無限にする" フィードバック対応)。
  freeUnits: "" as number | "",
};

function CouponsContent() {
  const { circleId: authCircleId, circleName: authCircleName } = useAuth();
  const circleId = authCircleId ?? "";
  const circleName = authCircleName ?? "サークルダッシュボード";
  const queryClient = useQueryClient();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState(initialForm);

  const {
    data: coupons,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["coupons", circleId],
    queryFn: () => couponApi.listByCircle(circleId),
    enabled: !!circleId,
  });

  // クーポンの対象選択肢 (2026-09-16 フィードバック対応)。メニュー/トッピング管理と同じ一覧を使う。
  const { data: menus } = useQuery({
    queryKey: ["menus", circleId],
    queryFn: () => menuApi.list(circleId),
    enabled: !!circleId,
  });
  const { data: toppings } = useQuery({
    queryKey: ["toppings", circleId],
    queryFn: () => toppingApi.list(circleId),
    enabled: !!circleId,
  });
  const menuName = (menuId: string) => menus?.find((m) => m.id === menuId)?.name ?? menuId;
  const toppingName = (toppingId: string) => toppings?.find((t) => t.id === toppingId)?.name ?? toppingId;

  // トッピングはメニューに紐付いていないと、客側の注文画面に選択肢として出てこない
  // (メニュー管理の「トッピング対応設定」で紐付けが必要)。紐付いていないトッピングを対象にした
  // free_topping クーポンは誰にも使われずに終わるため、作成前に気付けるよう警告する。
  const reachableToppingIds = new Set((menus ?? []).flatMap((m) => m.toppings ?? []).map((t) => t.id));

  const toggleFormMenu = (menuId: string) =>
    setForm((prev) => ({
      ...prev,
      menuIds: prev.menuIds.includes(menuId)
        ? prev.menuIds.filter((id) => id !== menuId)
        : [...prev.menuIds, menuId],
    }));
  const toggleFormTopping = (toppingId: string) =>
    setForm((prev) => ({
      ...prev,
      toppingIds: prev.toppingIds.includes(toppingId)
        ? prev.toppingIds.filter((id) => id !== toppingId)
        : [...prev.toppingIds, toppingId],
    }));

  const createMutation = useMutation({
    mutationFn: () => {
      const base = {
        title: form.title.trim(),
        passphrase: form.passphrase.trim(),
        maxRedemptions: form.maxRedemptions === "" ? undefined : form.maxRedemptions,
      };
      const input: CreateCouponInput =
        form.kind === "menu_discount"
          ? { kind: "menu_discount", ...base, discountAmount: Math.max(1, form.discountAmount), menuIds: form.menuIds }
          : {
              kind: "free_topping",
              ...base,
              freeUnits: form.freeUnits === "" ? undefined : form.freeUnits,
              toppingIds: form.toppingIds,
            };
      return couponApi.create(circleId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coupons", circleId] });
      toast.success("クーポンを作成しました");
      setShowCreateForm(false);
      setForm(initialForm);
    },
    onError: (e: any) => toast.error(e?.message || "クーポンの作成に失敗しました"),
  });

  const disableMutation = useMutation({
    mutationFn: (id: string) => couponApi.disable(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coupons", circleId] });
      toast.success("クーポンを無効化しました");
    },
    onError: (e: any) => toast.error(e?.message || "無効化に失敗しました"),
  });

  const couponUrl = (slug: string) => `${window.location.origin}/visitor/coupon/${slug}`;

  const copyShareText = async (c: Coupon) => {
    const text = `「${c.title}」\n${couponUrl(c.slug)}\n合言葉: ${c.passphrase}`;
    // 2026-10-08: 成功表示はブラウザーの書き込み完了後だけにし、失敗時の誤解を防ぐ。
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API is unavailable");
      await navigator.clipboard.writeText(text);
      toast.success("共有用の文面をコピーしました(URLと合言葉は同じチャットで送ってOKですが、口頭で合言葉だけ言うのは避けてください)");
    } catch {
      toast.error("クリップボードにコピーできませんでした。ブラウザーの権限を確認してください");
    }
  };

  const isFormValid =
    !!form.title.trim() &&
    !!form.passphrase.trim() &&
    (form.kind === "menu_discount"
      ? form.discountAmount >= 1 && form.menuIds.length > 0
      : form.toppingIds.length > 0);

  if (isLoading) {
    return (
      <DashboardLayout title={circleName} subtitle="クーポン管理" type="circle">
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </DashboardLayout>
    );
  }
  if (isError) {
    return (
      <DashboardLayout title={circleName} subtitle="クーポン管理" type="circle">
        <ErrorState error={error} onRetry={() => refetch()} />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      title={circleName}
      subtitle="クーポン管理"
      type="circle"
      actions={
        <PermissionGuard permission="coupon:write">
          <Button
            onClick={() => setShowCreateForm(true)}
            className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] font-bold shadow-none px-3"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            クーポン作成
          </Button>
        </PermissionGuard>
      }
    >
      <div className="space-y-6 font-mono">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          知り合い限定で使える割引クーポンを作成できます。URL(推測されにくいランダムな文字列)と合言葉の
          両方を知っている人だけが使えます。合言葉は口頭ではなく、URLと一緒にLINE等のテキストで伝えるのが安全です。
          使用上限回数に達すると、URLと合言葉を知っていても使えなくなります。
        </p>

        {!coupons || coupons.length === 0 ? (
          <EmptyState icon={Ticket} message="クーポンはまだありません" />
        ) : (
          <div className="space-y-3">
            {coupons.map((c) => {
              // maxRedemptions が null なら使用回数無制限 (2026-09-16 フィードバック対応)。
              const remaining = c.maxRedemptions === null ? Infinity : c.maxRedemptions - c.redeemedCount;
              const expired = c.expiresAt ? new Date(c.expiresAt).getTime() < Date.now() : false;
              const inactive = c.status === "disabled" || remaining <= 0 || expired;
              return (
                <Card key={c.id} className={inactive ? "opacity-60" : ""}>
                  <CardHeader className="pb-2 border-b-thick border-border">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="flex items-center gap-2 text-sm font-bold">
                        <Ticket className="h-4 w-4 shrink-0" />
                        {c.title}
                      </CardTitle>
                      <Badge variant={c.status === "disabled" ? "default" : remaining <= 0 || expired ? "warning" : "active"}>
                        {c.status === "disabled"
                          ? "無効"
                          : expired
                            ? "期限切れ"
                            : remaining <= 0
                              ? "使用済み"
                              : "有効"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
                      <span>
                        種類: <span className="text-foreground font-bold">{c.kind === "free_topping" ? "トッピング無料" : "金額引き"}</span>
                      </span>
                      {c.kind === "menu_discount" ? (
                        <span>割引額: <span className="text-foreground font-bold">¥{c.discountAmount?.toLocaleString()}</span></span>
                      ) : (
                        <span>無料個数: <span className="text-foreground font-bold">{c.freeUnits ?? "無制限"}</span></span>
                      )}
                      <span>使用状況: <span className="text-foreground font-bold">{c.redeemedCount} / {c.maxRedemptions ?? "無制限"}</span></span>
                      {c.expiresAt && <span>期限: {new Date(c.expiresAt).toLocaleString("ja-JP")}</span>}
                    </div>
                    <p className="text-muted-foreground">
                      対象{c.kind === "free_topping" ? "トッピング" : "メニュー"}:{" "}
                      <span className="text-foreground font-bold">
                        {c.kind === "free_topping" ? c.toppingIds.map(toppingName).join("、") : c.menuIds.map(menuName).join("、")}
                      </span>
                    </p>
                    {c.kind === "free_topping" && c.toppingIds.some((id) => !reachableToppingIds.has(id)) && (
                      <p className="text-warning">
                        対象トッピングがどのメニューにも紐付いていないため、お客様は選べず使えません。
                        <Link to="/circle/dashboard/menu" className="underline hover:text-foreground">
                          メニュー管理
                        </Link>
                        の「トッピング対応設定」で紐付けてください。
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        type="button"
                        onClick={() => copyShareText(c)}
                        className="h-7 border-thick border-border bg-background text-foreground rounded-none px-2 text-[11px] font-bold hover:bg-muted"
                      >
                        <Copy className="mr-1 h-3 w-3" />
                        共有用文面をコピー
                      </Button>
                      <PermissionGuard permission="coupon:write">
                        {c.status !== "disabled" && (
                          <Button
                            type="button"
                            onClick={() => disableMutation.mutate(c.id)}
                            disabled={disableMutation.isPending}
                            className="h-7 border-thick border-destructive text-destructive bg-background rounded-none px-2 text-[11px] font-bold hover:bg-destructive hover:text-white"
                          >
                            <Ban className="mr-1 h-3 w-3" />
                            無効化
                          </Button>
                        )}
                      </PermissionGuard>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* クーポン作成モーダル */}
      <Modal
        isOpen={showCreateForm}
        onClose={() => setShowCreateForm(false)}
        title="[クーポン作成]"
        subtitle="タイトルと合言葉、条件を設定します。作成後にURLと合言葉を知り合いへ伝えてください。"
      >
        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase">種類</p>
          <div className="flex gap-1.5">
            {(
              [
                ["menu_discount", "金額引き"],
                ["free_topping", "トッピング無料"],
              ] as [CouponKind, string][]
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => setForm({ ...form, kind })}
                className={cn(
                  "border-thin px-3 py-1.5 text-xs font-bold transition-all",
                  form.kind === kind
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            id="coupon-title"
            label="タイトル"
            required
            placeholder="友達限定割引"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <FormField
            id="coupon-passphrase"
            label="合言葉"
            required
            placeholder="fes2026"
            value={form.passphrase}
            onChange={(e) => setForm({ ...form, passphrase: e.target.value })}
          />
          {form.kind === "menu_discount" ? (
            <FormField
              id="coupon-discount"
              label="割引額 (円)"
              type="number"
              min={1}
              value={form.discountAmount}
              onChange={(e) => {
                const n = parseInt(e.target.value);
                setForm({ ...form, discountAmount: Number.isNaN(n) ? 0 : Math.max(0, n) });
              }}
            />
          ) : (
            <FormField
              id="coupon-free-units"
              label="無料にする個数 (空欄=無制限)"
              type="number"
              min={1}
              placeholder="無制限"
              value={form.freeUnits}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw.trim() === "") {
                  setForm({ ...form, freeUnits: "" });
                  return;
                }
                const n = parseInt(raw);
                setForm({ ...form, freeUnits: Number.isNaN(n) ? "" : Math.max(1, n) });
              }}
            />
          )}
          <FormField
            id="coupon-max"
            label="使用上限回数 (空欄=無制限)"
            type="number"
            min={1}
            max={100000}
            placeholder="無制限"
            value={form.maxRedemptions}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw.trim() === "") {
                setForm({ ...form, maxRedemptions: "" });
                return;
              }
              const n = parseInt(raw);
              setForm({ ...form, maxRedemptions: Number.isNaN(n) ? "" : Math.max(1, n) });
            }}
          />
        </div>

        {form.kind === "menu_discount" ? (
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase">対象メニュー *</p>
            <p className="text-[11px] text-muted-foreground">
              割引はここで選んだメニューの小計にのみ適用されます(カート全体からは引きません)。
            </p>
            {!menus || menus.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                先に
                <Link to="/circle/dashboard/menu" className="underline hover:text-foreground">
                  メニュー管理
                </Link>
                でメニューを登録してください
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {menus.map((m) => {
                  const on = form.menuIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleFormMenu(m.id)}
                      className={cn(
                        "border-thin px-2 py-1 text-[11px] font-bold transition-all",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:bg-muted"
                      )}
                    >
                      {m.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase">対象トッピング *</p>
            <p className="text-[11px] text-muted-foreground">
              ここで選んだトッピングが、カートに入っている分(数量分)から個数の上限まで無料になります。
              トッピングはメニューに紐付いていないと客側の注文画面に出せないため、対象にできるのは
              いずれかのメニューに紐付け済みのものだけです。
            </p>
            {!toppings || toppings.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                先に
                <Link to="/circle/dashboard/menu" className="underline hover:text-foreground">
                  メニュー管理
                </Link>
                の「トッピング管理」でトッピングを登録してください
              </p>
            ) : toppings.filter((t) => reachableToppingIds.has(t.id)).length === 0 ? (
              <p className="text-[11px] text-warning">
                登録済みのトッピングがどのメニューにも紐付いていません。
                <Link to="/circle/dashboard/menu" className="underline hover:text-foreground">
                  メニュー管理
                </Link>
                の「トッピング対応設定」で紐付けてから作成してください。
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {toppings
                  .filter((t) => reachableToppingIds.has(t.id))
                  .map((t) => {
                    const on = form.toppingIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleFormTopping(t.id)}
                        className={cn(
                          "border-thin px-2 py-1 text-[11px] font-bold transition-all",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background hover:bg-muted"
                        )}
                      >
                        {t.name}
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        <FormSubmitButton onClick={() => createMutation.mutate()} disabled={!isFormValid} isPending={createMutation.isPending} icon={Ticket}>
          作成する
        </FormSubmitButton>
      </Modal>
    </DashboardLayout>
  );
}

export default function CouponsPage() {
  return (
    <CircleAuthGuard>
      {/* 権限のないユーザーは API 403 の読み込み失敗ではなく、権限なし画面にする (2026-10-05) */}
      <PermissionGuard permission="coupon:read" showDenied>
        <CouponsContent />
      </PermissionGuard>
    </CircleAuthGuard>
  );
}
