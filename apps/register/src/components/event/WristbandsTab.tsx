import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { wristbandApi } from "@/lib/api";
import { extractIdFromCode } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lock, Search, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface WristbandsTabProps {
  eventId: string;
}

export function WristbandsTab({
  eventId
}: WristbandsTabProps) {
  const [lostSearchCode, setLostSearchCode] = useState("");
  const [newWristbandId, setNewWristbandId] = useState("");
  const [lookupResult, setLookupResult] = useState<any | null>(null);

  // リストバンド検索 API
  const lookupWristbandMutation = useMutation({
    mutationFn: (code: string) => {
      const parsedCode = extractIdFromCode(code);
      return wristbandApi.lookup(parsedCode);
    },
    onSuccess: (data) => {
      setLookupResult(data);
      if (!data.wristband) {
        toast.info("指定のコードに紐づく有効なリストバンドはありません");
      } else {
        toast.success("ユーザー情報を取得しました");
      }
    },
    onError: () => {
      toast.error("照会に失敗しました。正しいコードを入力してください。");
    },
  });

  // 紛失ロック API
  const reportLostMutation = useMutation({
    mutationFn: (wristbandId: string) => wristbandApi.reportLost(wristbandId),
    onSuccess: () => {
      toast.success("紛失ロック（無効化）が完了しました");
      if (lostSearchCode) {
        lookupWristbandMutation.mutate(lostSearchCode);
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "紛失ロックに失敗しました");
    },
  });

  // 新規リストバンド再紐付け
  const registerWristbandMutation = useMutation({
    mutationFn: (input: { userId: string; wristbandId: string }) =>
      wristbandApi.register(input.userId, input.wristbandId),
    onSuccess: () => {
      toast.success("新しいリストバンドをアカウントに紐付けました");
      setNewWristbandId("");
      if (lostSearchCode) {
        lookupWristbandMutation.mutate(lostSearchCode);
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "紐付けに失敗しました");
    },
  });

  const handleSearchLost = () => {
    if (!lostSearchCode.trim()) return;
    lookupWristbandMutation.mutate(lostSearchCode.trim());
  };

  const handleReportLost = (wbId: string) => {
    reportLostMutation.mutate(wbId);
  };

  const handleReissueWb = (userId: string) => {
    if (!newWristbandId.trim()) return;
    const parsedWbId = extractIdFromCode(newWristbandId);
    registerWristbandMutation.mutate({ userId, wristbandId: parsedWbId });
  };

  return (
    <div className="space-y-6 font-mono text-foreground">
      <div className="flex justify-between items-center border-b-thick border-border pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Lock className="h-4 w-4" />
          リストバンド紛失のロック・再発行処理
        </h2>
      </div>

      <Card className=" rounded-none bg-background shadow-none">
        <CardHeader className="p-4 pb-2 border-b-thin border-border bg-muted/20">
          <CardTitle className="text-xs uppercase font-bold">[登録情報スキャン・照会]</CardTitle>
          <CardDescription className="text-[10px]">紛失したと思われるリストバンドID、または来場者ユーザーIDを入力して照会します。</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-4 space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="例: wb_test_001 または usr_xxxx"
              value={lostSearchCode}
              onChange={(e) => setLostSearchCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearchLost();
                }
              }}
              className="border-thick border-border rounded-none focus-visible:ring-0 h-10 text-xs bg-background font-mono flex-1"
            />
            <Button
              onClick={handleSearchLost}
              disabled={!lostSearchCode.trim() || lookupWristbandMutation.isPending}
              className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-10 text-xs font-bold rounded-none shadow-none px-4"
            >
              <Search className="h-4 w-4 mr-1" />
              照会
            </Button>
          </div>

          {/* 照会結果表示 */}
          {lookupResult && (
            <div className="p-4 bg-muted/10 space-y-4 text-xs font-mono">
              <div className="border-b-thick border-border pb-2">
                <h4 className="font-bold uppercase text-[10px] text-muted-foreground mb-1">[来場者アカウント情報]</h4>
                <p>ユーザーID: {lookupResult.user.id}</p>
                <p>表示用呼び出しID: #{lookupResult.user.displayId}</p>
                <p>状態: {lookupResult.user.status}</p>
                <p>ニックネーム: {lookupResult.user.nickname || "未登録"}</p>
              </div>

              <div className="border-b-thick border-border pb-2">
                <h4 className="font-bold uppercase text-[10px] text-muted-foreground mb-1">[紐付く物理リストバンド]</h4>
                {lookupResult.wristband ? (
                  <div className="space-y-2">
                    <p>リストバンドコード: {lookupResult.wristband.id}</p>
                    <p className="flex items-center gap-2">
                      状態:
                      <Badge variant="default" className={`rounded-none text-[8px] font-mono border-thick border-border uppercase ${
                        lookupResult.wristband.status === "active"
                          ? "bg-green-50/10 text-green-700 border-green-500"
                          : "bg-red-50/10 text-red-700 border-red-500"
                      }`}>
                        {lookupResult.wristband.status}
                      </Badge>
                    </p>
                    <p>割当日時: {new Date(lookupResult.wristband.assignedAt).toLocaleString("ja-JP")}</p>

                    {lookupResult.wristband.status === "active" && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleReportLost(lookupResult.wristband.id)}
                        disabled={reportLostMutation.isPending}
                        className="rounded-none text-[9px] font-bold h-8 uppercase mt-1.5 shadow-none border border-transparent"
                      >
                        リストバンド紛失報告（即時ロック）
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground italic text-[10px]">有効な物理リストバンドは紐付いていません</p>
                )}
              </div>

              {/* 再発行（新規リストバンドの紐付け） */}
              <div className="space-y-2">
                <h4 className="font-bold uppercase text-[10px] text-muted-foreground">[新しいリストバンドの紐付け・再発行]</h4>
                <p className="text-[10px] text-muted-foreground">新しい物理リストバンドのQR/コード値を入力して登録します（古いリストバンドは自動的に無効化されます）。</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="新しいリストバンドIDを入力"
                    value={newWristbandId}
                    onChange={(e) => setNewWristbandId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleReissueWb(lookupResult.user.id);
                      }
                    }}
                    className="border-thick border-border rounded-none focus-visible:ring-0 h-10 text-xs bg-background font-mono flex-1"
                  />
                  <Button
                    onClick={() => handleReissueWb(lookupResult.user.id)}
                    disabled={!newWristbandId.trim() || registerWristbandMutation.isPending}
                    className="border-thick border-border bg-background text-foreground hover:bg-primary hover:text-primary-foreground h-10 text-xs font-bold rounded-none shadow-none px-4"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin-hover" />
                    再発行登録
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
