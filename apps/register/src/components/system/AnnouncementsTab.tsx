import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  adminApi,
  type AdminAnnouncement,
  type AnnouncementInput,
  type AnnouncementLevel,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { OptionCard } from "@/components/ui/OptionCard";
import { undoableDelete } from "@/lib/toast-undo";
import { toast } from "sonner";
import { Megaphone, Plus, Trash2, Info, AlertTriangle, OctagonAlert, Save, X } from "lucide-react";

const LEVELS: { value: AnnouncementLevel; label: string; description: string; icon: any }[] = [
  { value: "info", label: "お知らせ", description: "通常の案内", icon: Info },
  { value: "warning", label: "注意", description: "注意喚起", icon: AlertTriangle },
  { value: "critical", label: "重要", description: "重大な通知", icon: OctagonAlert },
];

const LEVEL_BADGE: Record<AnnouncementLevel, string> = {
  info: "bg-primary text-primary-foreground",
  warning: "bg-warning text-black",
  critical: "bg-destructive text-destructive-foreground",
};

const EMPTY: AnnouncementInput = { title: "", body: "", level: "info", published: false };

export function AnnouncementsTab() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<null | { id?: string; data: AnnouncementInput }>(null);

  const {
    data: list,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["adminAnnouncements"],
    queryFn: () => adminApi.listAnnouncements(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["adminAnnouncements"] });
    queryClient.invalidateQueries({ queryKey: ["publicAnnouncements"] });
  };

  const createM = useMutation({
    mutationFn: (data: AnnouncementInput) => adminApi.createAnnouncement(data),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      toast.success("お知らせを作成しました");
    },
    onError: (e: any) => toast.error(e.message || "作成に失敗しました"),
  });

  const updateM = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AnnouncementInput> }) =>
      adminApi.updateAnnouncement(id, data),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      toast.success("お知らせを更新しました");
    },
    onError: (e: any) => toast.error(e.message || "更新に失敗しました"),
  });

  const handleDelete = (a: AdminAnnouncement) =>
    undoableDelete<AdminAnnouncement>({
      queryClient,
      queryKey: ["adminAnnouncements"],
      id: a.id,
      message: `「${a.title}」を削除しました`,
      commit: async () => {
        await adminApi.deleteAnnouncement(a.id);
        queryClient.invalidateQueries({ queryKey: ["publicAnnouncements"] });
      },
    });

  const togglePublish = (a: AdminAnnouncement) =>
    updateM.mutate({ id: a.id, data: { published: !a.published } });

  const saveEditing = () => {
    if (!editing) return;
    if (!editing.data.title.trim()) {
      toast.error("タイトルは必須です");
      return;
    }
    if (editing.id) updateM.mutate({ id: editing.id, data: editing.data });
    else createM.mutate(editing.data);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 border-b-thick border-border pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Megaphone className="h-4 w-4" />
          お知らせ管理 {list ? `(${list.length})` : ""}
        </h2>
        {!editing && (
          <Button
            onClick={() => setEditing({ data: { ...EMPTY } })}
            className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] uppercase font-bold shadow-none px-3"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            新規作成
          </Button>
        )}
      </div>

      {/* 作成/編集フォーム */}
      {editing && (
        <AnnouncementForm
          value={editing.data}
          onChange={(data) => setEditing((e) => (e ? { ...e, data } : e))}
          onSave={saveEditing}
          onCancel={() => setEditing(null)}
          isPending={createM.isPending || updateM.isPending}
          isEdit={!!editing.id}
        />
      )}

      {/* 一覧 */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : list && list.length > 0 ? (
        <div className="space-y-3">
          {list.map((a) => (
            <div key={a.id} className="border-thick border-border p-3 bg-background space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${LEVEL_BADGE[a.level]}`}
                    >
                      {LEVELS.find((l) => l.value === a.level)?.label || a.level}
                    </span>
                    <span className="text-sm font-bold truncate">{a.title}</span>
                  </div>
                  {a.body && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                      {a.body}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex flex-col items-center gap-0.5">
                    <ToggleSwitch
                      checked={a.published}
                      onChange={() => togglePublish(a)}
                      label="公開切替"
                    />
                    <span className="text-[8px] font-black uppercase text-muted-foreground">
                      {a.published ? "公開中" : "下書き"}
                    </span>
                  </div>
                  <Button
                    onClick={() => setEditing({ id: a.id, data: { title: a.title, body: a.body, level: a.level, published: a.published } })}
                    className="rounded-none border-thick border-border h-8 text-[10px] uppercase font-bold px-2 bg-background text-foreground hover:bg-primary hover:text-primary-foreground shadow-none"
                  >
                    編集
                  </Button>
                  <Button
                    onClick={() => handleDelete(a)}
                    className="rounded-none border-thick border-border h-8 text-destructive hover:bg-destructive hover:text-destructive-foreground px-2 bg-background shadow-none"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Megaphone}
          message="お知らせがありません"
          actionLabel="新規作成"
          onAction={() => setEditing({ data: { ...EMPTY } })}
        />
      )}

    </div>
  );
}

function AnnouncementForm({
  value,
  onChange,
  onSave,
  onCancel,
  isPending,
  isEdit,
}: {
  value: AnnouncementInput;
  onChange: (v: AnnouncementInput) => void;
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
  isEdit: boolean;
}) {
  return (
    <div className="border-thick border-primary p-4 space-y-4 bg-muted/20">
      <div className="flex items-center justify-between border-b-thick border-border pb-2">
        <h3 className="text-xs font-black uppercase tracking-wider">
          {isEdit ? "お知らせを編集" : "新しいお知らせ"}
        </h3>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground cursor-pointer">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase">タイトル *</Label>
        <Input
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="例: 本日の開催について"
          className="border-thick border-border rounded-none focus-visible:ring-0 bg-background text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase">本文</Label>
        <textarea
          value={value.body}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          rows={3}
          placeholder="お知らせの内容"
          className="w-full border-thick border-border rounded-none focus-visible:outline-none bg-background text-sm font-mono p-2"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase">レベル</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {LEVELS.map((lv) => (
            <OptionCard
              key={lv.value}
              icon={lv.icon}
              label={lv.label}
              description={lv.description}
              selected={value.level === lv.value}
              onSelect={() => onChange({ ...value, level: lv.value })}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-thick border-border p-3 bg-background">
        <div>
          <div className="text-xs font-bold uppercase">すぐに公開する</div>
          <div className="text-[10px] text-muted-foreground">OFF なら下書き保存されます</div>
        </div>
        <ToggleSwitch
          checked={value.published ?? false}
          onChange={(v) => onChange({ ...value, published: v })}
          label="公開"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          onClick={onCancel}
          className="rounded-none border-thick border-border bg-background text-foreground hover:bg-muted h-9 text-xs font-bold uppercase px-4 shadow-none"
        >
          キャンセル
        </Button>
        <Button
          onClick={onSave}
          disabled={isPending}
          className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-9 text-xs font-bold uppercase px-4 shadow-none"
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {isPending ? "保存中..." : "保存"}
        </Button>
      </div>
    </div>
  );
}
