
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CircleAuthGuard } from "@/hooks/useCircleAuth";
import { circleApi } from "@/lib/api";
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
      <div className="container mx-auto p-4 space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold">サークル設定</h1>

      <Card>
        <CardHeader>
          <CardTitle>基本情報</CardTitle>
          <CardDescription>サークルの基本情報を編集できます</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">サークル名</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例: 2年1組"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">説明</Label>
            <Input
              id="description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="サークルの説明"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="iconImagePath">アイコン画像パス</Label>
            <Input
              id="iconImagePath"
              value={form.iconImagePath}
              onChange={(e) =>
                setForm({ ...form, iconImagePath: e.target.value })
              }
              placeholder="/images/circle/icon.jpg"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="backgroundImagePath">背景画像パス</Label>
            <Input
              id="backgroundImagePath"
              value={form.backgroundImagePath}
              onChange={(e) =>
                setForm({ ...form, backgroundImagePath: e.target.value })
              }
              placeholder="/images/circle/background.jpg"
            />
          </div>

          <Button onClick={handleSave} disabled={updateCircle.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {updateCircle.isPending ? "保存中..." : "保存"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>サークルID</CardTitle>
          <CardDescription>このIDは変更できません</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="bg-secondary p-2 rounded">{circleId}</code>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CircleSettingsPage() {
  return (
    <CircleAuthGuard>
      <CircleSettingsContent />
    </CircleAuthGuard>
  );
}
