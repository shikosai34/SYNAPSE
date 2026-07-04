import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { toast } from "sonner";
import { Save } from "lucide-react";

function CircleSettingsContent() {
  const [circleId, setCircleId] = useState<string>("");
  const [circleName, setCircleName] = useState<string>("サークルダッシュボード");
  const [form, setForm] = useState({
    name: "",
    description: "",
    iconImagePath: "",
    backgroundImagePath: "",
  });

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
    if (circle) {
      setForm({
        name: circle.name,
        description: circle.description || "",
        iconImagePath: "",
        backgroundImagePath: "",
      });
    }
  }, [circle]);

  const updateCircle = useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      description?: string;
    }) => {
      const { id, ...data } = input;
      return await circleApi.update(id, data);
    },
    onSuccess: () => {
      toast.success("サークル情報を更新しました");
      // ローカルストレージも更新
      localStorage.setItem("circleName", form.name);
    },
    onError: (error: any) => {
      toast.error(error.message || "更新に失敗しました");
    },
  });

  const handleSave = () => {
    updateCircle.mutate({
      id: circleId,
      name: form.name,
      description: form.description,
    });
  };

  if (isLoading) {
    return (
      <DashboardLayout title={circleName} subtitle="サークル設定" type="circle">
        <div className="space-y-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-96" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={circleName} subtitle="サークル設定" type="circle">
      <div className="space-y-6">
        <Card className="border-thick border-border rounded-none shadow-none">
          <CardHeader className="pb-3 border-b-thick border-border">
            <CardTitle className="text-sm font-bold uppercase">基本情報</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">サークルの基本情報を編集できます</CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-xs font-bold uppercase">サークル名</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例: 2年1組"
                className="border-thick border-border rounded-none focus-visible:ring-0 bg-background text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-xs font-bold uppercase">説明</Label>
              <Input
                id="description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="サークルの説明"
                className="border-thick border-border rounded-none focus-visible:ring-0 bg-background text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="iconImagePath" className="text-xs font-bold uppercase">アイコン画像パス</Label>
              <Input
                id="iconImagePath"
                value={form.iconImagePath}
                onChange={(e) =>
                  setForm({ ...form, iconImagePath: e.target.value })
                }
                placeholder="/images/circle/icon.jpg"
                className="border-thick border-border rounded-none focus-visible:ring-0 bg-background text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="backgroundImagePath" className="text-xs font-bold uppercase">背景画像パス</Label>
              <Input
                id="backgroundImagePath"
                value={form.backgroundImagePath}
                onChange={(e) =>
                  setForm({ ...form, backgroundImagePath: e.target.value })
                }
                placeholder="/images/circle/background.jpg"
                className="border-thick border-border rounded-none focus-visible:ring-0 bg-background text-sm"
              />
            </div>

            <Button onClick={handleSave} disabled={updateCircle.isPending} className="rounded-none text-xs font-bold bg-primary text-primary-foreground hover:bg-background hover:text-foreground border-thick border-transparent hover:border-border h-9 shadow-none px-4">
              <Save className="mr-2 h-4 w-4" />
              {updateCircle.isPending ? "保存中..." : "変更を保存"}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-thick border-border rounded-none shadow-none">
          <CardHeader className="pb-3 border-b-thick border-border">
            <CardTitle className="text-sm font-bold uppercase">サークルID</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">このIDはシステム内で一意であり、変更できません</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <code className="bg-muted px-3 py-1.5 text-xs rounded-none border-thick border-border block w-fit font-mono">{circleId}</code>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

export default function CircleSettingsPage() {
  return (
    <CircleAuthGuard>
      <CircleSettingsContent />
    </CircleAuthGuard>
  );
}
