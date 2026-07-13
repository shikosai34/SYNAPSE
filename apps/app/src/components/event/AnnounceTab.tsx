import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { eventApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Megaphone } from "lucide-react";

// イベント内スタッフへの一斉アナウンス (2026-07-12)
// イベント配下の全メンバー(イベントスタッフ+全サークルのスタッフ)へ通知を送る。
// 受信者は既存の通知センター(ヘッダーのベル)で受け取る。
export function AnnounceTab({ eventId }: { eventId: string }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");

  const send = useMutation({
    mutationFn: () => eventApi.announce(eventId, { title: title.trim(), message: message.trim() }),
    onSuccess: (res) => {
      toast.success(`${res.sent} 名のスタッフに送信しました`);
      setTitle("");
      setMessage("");
    },
    onError: (e: any) => toast.error(e?.message || "送信に失敗しました"),
  });

  const canSend = title.trim().length > 0 && message.trim().length > 0;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="border-b-thick border-border pb-3">
        <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
          <Megaphone className="h-4 w-4" /> 一斉アナウンス
        </h2>
        <p className="text-[11px] text-muted-foreground font-mono mt-1 leading-[1.6]">
          イベント配下の<strong className="text-foreground">全スタッフ</strong>(イベントスタッフ + 各サークルのスタッフ)へ
          通知を送ります。受信者はヘッダーの通知(ベル)で確認できます。
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="an-title">タイトル</Label>
        <Input
          id="an-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 15時から雨天対応に切り替えます"
          maxLength={120}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="an-message">本文</Label>
        <textarea
          id="an-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="スタッフへの連絡内容を入力してください"
          maxLength={2000}
          rows={5}
          className="w-full border-thick border-border bg-background p-2 font-mono text-[13px] resize-y focus:outline-none focus:border-accent"
        />
      </div>

      <Button
        className="w-full"
        size="lg"
        disabled={!canSend || send.isPending}
        onClick={() => send.mutate()}
      >
        {send.isPending ? "送信中..." : "全スタッフに送信する"}
      </Button>
      <p className="font-mono text-[10px] text-muted-foreground">
        送信は取り消せません。緊急連絡・重要な変更に利用してください。
      </p>
    </div>
  );
}
