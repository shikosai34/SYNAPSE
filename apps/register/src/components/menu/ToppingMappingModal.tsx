import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { menuApi, toppingApi } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { ErrorState } from "@/components/ui/ErrorState";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface ToppingMappingModalProps {
  circleId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ToppingMappingModal({ circleId, isOpen, onClose }: ToppingMappingModalProps) {
  const queryClient = useQueryClient();

  // メニューとトッピングを取得
  const {
    data: menus,
    isLoading: menusLoading,
    isError: menusError,
    error: menusErrorObj,
    refetch: refetchMenus,
  } = useQuery({
    queryKey: ["menus", circleId],
    queryFn: () => menuApi.list(circleId),
    enabled: isOpen && !!circleId,
  });

  const {
    data: toppings,
    isLoading: toppingsLoading,
    isError: toppingsError,
    error: toppingsErrorObj,
    refetch: refetchToppings,
  } = useQuery({
    queryKey: ["toppings", circleId],
    queryFn: () => toppingApi.list(circleId),
    enabled: isOpen && !!circleId,
  });

  // メニューごとのトッピング紐付け状態（ローカル管理）
  const [mappings, setMappings] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (menus) {
      const initial: Record<string, string[]> = {};
      for (const m of menus) {
        initial[m.id] = (m.toppings || []).map((t) => t.id);
      }
      setMappings(initial);
    }
  }, [menus]);

  // マッピング更新 API
  const updateMappingMutation = useMutation({
    mutationFn: (args: { menuId: string; toppingIds: string[] }) =>
      menuApi.update(args.menuId, { toppingIds: args.toppingIds }),
    onSuccess: () => {
      toast.success("トッピング対応関係を自動保存しました", { id: "mapping-auto-save" });
      queryClient.invalidateQueries({ queryKey: ["menus", circleId] });
    },
    onError: (err: any) => {
      toast.error(`マッピング保存失敗: ${err.message}`);
    },
  });

  const handleCheckboxChange = (menuId: string, toppingId: string, checked: boolean) => {
    setMappings((prev) => {
      const current = prev[menuId] || [];
      const updated = checked
        ? [...current, toppingId]
        : current.filter((id) => id !== toppingId);

      // 選択は即座に自動保存
      toast.loading("対応関係を保存中...", { id: "mapping-auto-save" });
      updateMappingMutation.mutate({ menuId, toppingIds: updated });

      return { ...prev, [menuId]: updated };
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="xl"
      title="[メニュー・トッピング対応設定]"
      subtitle="各メニューに対して有効にするトッピングを選択してください。選択は即座に自動保存されます。"
    >
      {menusLoading || toppingsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : menusError || toppingsError ? (
        // 2026-07-07 (Phase6 UX堅牢化): どちらかの取得が失敗した場合、モーダルが
        // 空の状態のまま何も操作できなくなっていたため ErrorState + 再試行を追加。
        <ErrorState
          error={menusErrorObj ?? toppingsErrorObj}
          onRetry={() => {
            if (menusError) refetchMenus();
            if (toppingsError) refetchToppings();
          }}
        />
      ) : !menus || menus.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-12">
          メニューが登録されていません。先にメニューを作成してください。
        </p>
      ) : !toppings || toppings.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-12">
          トッピングが登録されていません。先にトッピングを作成してください。
        </p>
      ) : (
        <div className="space-y-4">
          {menus.map((menu) => {
            const selectedToppingIds = mappings[menu.id] || [];

            return (
              <div key={menu.id} className="border-thick border-border p-4 bg-muted/20 space-y-3">
                <div className="flex justify-between items-center border-b-thin border-border pb-2">
                  <span className="font-bold text-xs uppercase tracking-wider">
                    {menu.name} (¥{menu.price.toLocaleString()})
                  </span>
                  <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5">
                    トッピング選択数: {selectedToppingIds.length}個
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {toppings.map((topping) => {
                    const isChecked = selectedToppingIds.includes(topping.id);

                    return (
                      <label
                        key={topping.id}
                        className={`flex items-center gap-2 border-thin p-2 text-xs cursor-pointer transition-colors ${
                          isChecked
                            ? "border-primary bg-primary/5 font-bold"
                            : "border-border bg-background hover:bg-muted"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) =>
                            handleCheckboxChange(menu.id, topping.id, e.target.checked)
                          }
                          // 2026-07-07 (Phase6 UX堅牢化): 自動保存中に連打すると
                          // updateMappingMutation へのリクエストが重複しうるため、
                          // 保存中はチェックボックスを disabled にする。
                          disabled={updateMappingMutation.isPending}
                          className="w-4 h-4 rounded-none border-thin border-border focus:ring-0 focus:ring-offset-0 disabled:opacity-50"
                        />
                        {topping.imagePath && (
                          <img
                            src={topping.imagePath}
                            alt={topping.name}
                            className="h-8 w-8 object-cover border-thick border-border shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="truncate">{topping.name}</p>
                          <p className="text-[10px] text-muted-foreground font-normal">
                            +¥{topping.price}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
