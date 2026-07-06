import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAuthGuard } from "@/hooks/useCircleAuth";
import { circleApi } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "sonner";
import { Save, Sparkles, Plus, Trash2, Globe, Upload } from "lucide-react";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";

interface SettingsSchemaField {
  key: string;
  label: string;
  type: "string" | "text" | "boolean" | "number";
  default: any;
}

interface ModManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  settingsSchema: SettingsSchemaField[];
  hooks: {
    menuHeader?: string;
    menuBodyBottom?: string;
    registerAction?: string;
    [key: string]: any;
  };
}

interface InstalledModState {
  manifest: ModManifest;
  enabled: boolean;
  settings: Record<string, any>;
}

interface ModsPayload {
  installed: Record<string, InstalledModState>;
}

function ModsSettingsContent() {
  const [circleId, setCircleId] = useState<string>("");
  const [circleName, setCircleName] = useState<string>("サークルダッシュボード");
  const queryClient = useQueryClient();

  const [installedMods, setInstalledMods] = useState<Record<string, InstalledModState>>({});
  const [manifestUrl, setManifestUrl] = useState("");
  const [isUrlImportOpen, setIsUrlImportOpen] = useState(false);
  // アンインストール確認 (native confirm を廃止しアプリ内ダイアログで確認 2026-07-04)
  const [pendingUninstall, setPendingUninstall] = useState<{ id: string; name: string } | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const manifest = JSON.parse(text) as ModManifest;
        installMod(manifest);
      } catch (err) {
        toast.error("JSONファイルのパースに失敗しました。正しい形式であることを確認してください。");
      }
    };
    reader.readAsText(file);
    // Reset output to allow consecutive upload of same file
    e.target.value = "";
  };

  useEffect(() => {
    const storedCircleId = localStorage.getItem("circleId");
    if (storedCircleId) {
      setCircleId(storedCircleId);
    }
    const authStored = localStorage.getItem("circleAuth");
    if (authStored) {
      try {
        const authInfo = JSON.parse(authStored);
        if (authInfo.circleName) {
          setCircleName(authInfo.circleName);
        }
      } catch (_) {}
    }
  }, []);

  const { data: circle, isLoading } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId),
    enabled: !!circleId,
  });

  useEffect(() => {
    if (circle && circle.mods) {
      try {
        const parsed = JSON.parse(circle.mods) as ModsPayload;
        if (parsed && parsed.installed) {
          setInstalledMods(parsed.installed);
        } else {
          setInstalledMods({});
        }
      } catch (e) {
        console.error("Failed to parse mods JSON:", e);
        setInstalledMods({});
      }
    }
  }, [circle]);

  const updateModsMutation = useMutation({
    mutationFn: async (mods: ModsPayload) => {
      return await circleApi.updateMods(circleId, mods);
    },
    onSuccess: () => {
      toast.success("拡張機能の設定を保存しました");
      queryClient.invalidateQueries({ queryKey: ["circle", circleId] });
    },
    onError: (error: any) => {
      toast.error(error.message || "設定の保存に失敗しました");
    },
  });

  const handleSave = () => {
    updateModsMutation.mutate({ installed: installedMods });
  };

  // モッドのインストール処理
  const installMod = (manifest: ModManifest) => {
    if (!manifest.id || !manifest.name) {
      toast.error("無効なマニフェスト形式です。(idとnameは必須です)");
      return;
    }

    if (installedMods[manifest.id]) {
      toast.info(`モッド「${manifest.name}」は既にインストールされています。`);
      return;
    }

    // デフォルトの設定値を構築
    const defaultSettings: Record<string, any> = {};
    if (manifest.settingsSchema) {
      manifest.settingsSchema.forEach((field) => {
        defaultSettings[field.key] = field.default;
      });
    }

    const updated = {
      ...installedMods,
      [manifest.id]: {
        manifest,
        enabled: false,
        settings: defaultSettings,
      },
    };

    setInstalledMods(updated);
    toast.success(`モッド「${manifest.name}」をインストールしました。有効化して設定を行ってください。`);
  };

  // URLからインポート
  const handleUrlImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manifestUrl.trim()) return;

    try {
      const res = await fetch(manifestUrl.trim());
      if (!res.ok) throw new Error("マニフェストの取得に失敗しました");
      const manifest = (await res.json()) as ModManifest;
      installMod(manifest);
      setManifestUrl("");
      setIsUrlImportOpen(false);
    } catch (err: any) {
      toast.error(err.message || "インポート中にエラーが発生しました");
    }
  };

  // アンインストール (確認ダイアログ経由で実行)
  const uninstallMod = (id: string, name: string) => {
    setPendingUninstall({ id, name });
  };

  const confirmUninstall = () => {
    if (!pendingUninstall) return;
    const updated = { ...installedMods };
    delete updated[pendingUninstall.id];
    setInstalledMods(updated);
    toast.success("アンインストールしました。設定を保存すると反映されます。");
    setPendingUninstall(null);
  };

  // 設定値の更新
  const updateSettingValue = (modId: string, key: string, value: any) => {
    setInstalledMods((prev) => {
      const mod = prev[modId];
      if (!mod) return prev;
      return {
        ...prev,
        [modId]: {
          ...mod,
          settings: {
            ...mod.settings,
            [key]: value,
          },
        },
      };
    });
  };

  // 有効・無効トグル
  const toggleMod = (modId: string) => {
    setInstalledMods((prev) => {
      const mod = prev[modId];
      if (!mod) return prev;
      return {
        ...prev,
        [modId]: {
          ...mod,
          enabled: !mod.enabled,
        },
      };
    });
  };

  if (isLoading) {
    return (
      <DashboardLayout title={circleName} subtitle="拡張機能 (モッド)" type="circle">
        <div className="space-y-4 font-mono">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-96 w-full animate-pulse" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={circleName} subtitle="拡張機能 (モッド)" type="circle">
      <div className="space-y-6 font-mono">
        <div className="border-b-thick border-border pb-3 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider">[拡張機能管理]</h2>
            <p className="text-[10px] text-muted-foreground mt-1">
              外部リポジトリなどから配布されたモッドをインポートし、独自に拡張できます
            </p>
          </div>
        </div>

        {/* インポートセクション */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            onClick={() => {
              setIsUrlImportOpen(!isUrlImportOpen);
            }}
            variant="outline"
            className="h-11 border-thick border-border font-mono text-xs font-bold rounded-none uppercase flex items-center justify-center gap-1.5"
          >
            <Globe className="h-4 w-4" />
            URLからモッドを導入
          </Button>
          <div>
            <input
              type="file"
              id="mod-file-upload"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              onClick={() => document.getElementById("mod-file-upload")?.click()}
              variant="outline"
              className="w-full h-11 border-thick border-border font-mono text-xs font-bold rounded-none uppercase flex items-center justify-center gap-1.5"
            >
              <Upload className="h-4 w-4" />
              JSONファイルをアップロード
            </Button>
          </div>
        </div>

        {/* URLインポートパネル */}
        {isUrlImportOpen && (
          <Card className=" rounded-none p-4 bg-muted space-y-3">
            <form onSubmit={handleUrlImport} className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <Label htmlFor="manifestUrl" className="sr-only">マニフェストURL</Label>
                <Input
                  id="manifestUrl"
                  type="url"
                  placeholder="https://example.com/mod/manifest.json"
                  className="h-10 border-thick border-border bg-background rounded-none font-mono text-xs focus-visible:ring-0"
                  value={manifestUrl}
                  onChange={(e) => setManifestUrl(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                className="h-10 border-thick border-primary bg-primary text-primary-foreground rounded-none font-mono hover:bg-background hover:text-foreground font-bold text-xs uppercase shrink-0 px-4"
              >
                <Plus className="mr-1 h-4 w-4" />
                導入
              </Button>
            </form>
            <p className="text-[10px] text-muted-foreground">
              ※モッドのリポジトリで公開されている Raw 状態 of `manifest.json` のURLを入力してください。
            </p>
          </Card>
        )}

        {/* インストール済みモッド一覧・設定 */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase border-b-thick border-border pb-1.5 flex items-center gap-2">
            <span>[インストール済みの拡張機能]</span>
            <span className="text-[10px] font-normal text-muted-foreground">({Object.keys(installedMods).length}個)</span>
          </h3>

          {Object.keys(installedMods).length === 0 ? (
            <div className="border-thick border-dashed border-border p-8 text-center bg-muted">
              <p className="text-xs text-muted-foreground font-bold">インストールされた拡張機能はありません。</p>
              <p className="text-[10px] text-muted-foreground/80 mt-1">
                上のボタンから、コミュニティ等で配布されているマニフェストのURLまたはJSONを入力して導入してください。
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(installedMods).map(([modId, modState]) => {
                const { manifest, enabled, settings } = modState;
                return (
                  <Card key={modId} className=" rounded-none shadow-none">
                    <CardHeader className="border-b-thick border-border bg-accent text-accent-foreground p-4">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div>
                          <CardTitle className="text-base font-bold flex items-center gap-1.5">
                            <Sparkles className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                            {manifest.name}
                          </CardTitle>
                          <CardDescription className="text-[10px] mt-1 text-accent-foreground/80">
                            {manifest.description}
                            {manifest.author && <span className="block mt-0.5">開発者: {manifest.author} | v{manifest.version}</span>}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-3 w-full sm:w-auto shrink-0">
                          <div className="flex items-center gap-2 border-thick border-accent-foreground/40 bg-background/10 px-3 h-9">
                            <span className="text-[10px] font-black uppercase w-8">
                              {enabled ? "有効" : "無効"}
                            </span>
                            <ToggleSwitch
                              checked={enabled}
                              onChange={() => toggleMod(modId)}
                              label={`${manifest.name} の有効化`}
                            />
                          </div>
                          <Button
                            type="button"
                            onClick={() => uninstallMod(modId, manifest.name)}
                            className="border-thick border-border bg-background text-foreground hover:bg-destructive hover:text-destructive-foreground rounded-none h-9 p-2 shrink-0"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>

                    {/* 動的設定項目レンダリング */}
                    {enabled && manifest.settingsSchema && manifest.settingsSchema.length > 0 && (
                      <CardContent className="p-4 space-y-3">
                        <p className="text-[10px] font-bold uppercase mb-2 border-b-thick border-border pb-1">[設定項目]</p>
                        {manifest.settingsSchema.map((field) => {
                          const currentValue = settings[field.key] ?? field.default;
                          return (
                            <div key={field.key} className="space-y-1">
                              <Label htmlFor={`${modId}-${field.key}`} className="font-bold text-[11px] uppercase">
                                {field.label}
                              </Label>
                              {field.type === "text" ? (
                                <textarea
                                  id={`${modId}-${field.key}`}
                                  value={currentValue}
                                  onChange={(e) => updateSettingValue(modId, field.key, e.target.value)}
                                  className="flex min-h-[80px] w-full bg-background text-foreground border-thick border-border px-3 py-2 text-xs transition-all outline-none focus-visible:ring-0 rounded-none font-mono"
                                />
                              ) : field.type === "boolean" ? (
                                <div className="flex items-center">
                                  <Button
                                    type="button"
                                    variant={currentValue ? "default" : "outline"}
                                    onClick={() => updateSettingValue(modId, field.key, !currentValue)}
                                    className="border-thick border-border font-bold rounded-none h-8 text-[10px] px-3"
                                  >
                                    {currentValue ? "はい (ON)" : "いいえ (OFF)"}
                                  </Button>
                                </div>
                              ) : (
                                <Input
                                  id={`${modId}-${field.key}`}
                                  type={field.type === "number" ? "number" : "text"}
                                  value={currentValue}
                                  onChange={(e) => updateSettingValue(modId, field.key, field.type === "number" ? Number(e.target.value) : e.target.value)}
                                  className="h-9 border-thick border-border bg-background rounded-none focus-visible:ring-0 text-xs font-mono"
                                />
                              )}
                            </div>
                          );
                        })}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          <div className="flex justify-end pt-4 border-t-thick border-border">
            <Button
              onClick={handleSave}
              disabled={updateModsMutation.isPending}
              className="h-11 border-thick border-primary bg-primary font-mono text-xs font-bold text-primary-foreground rounded-none hover:bg-background hover:text-foreground uppercase px-6"
            >
              <Save className="mr-1.5 h-4 w-4" />
              {updateModsMutation.isPending ? "保存中..." : "変更を確定して保存"}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!pendingUninstall}
        title="[拡張機能のアンインストール]"
        description={`拡張機能「${pendingUninstall?.name ?? ""}」をアンインストールしますか？ 設定データも削除されます。`}
        confirmLabel="アンインストール"
        onConfirm={confirmUninstall}
        onCancel={() => setPendingUninstall(null)}
      />
    </DashboardLayout>
  );
}

export default function ModsSettingsPage() {
  return (
    <CircleAuthGuard>
      <ModsSettingsContent />
    </CircleAuthGuard>
  );
}
