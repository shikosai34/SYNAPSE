import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { wristbandApi } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

interface IssueTabProps {
  eventId: string;
}

export function IssueTab({
  eventId
}: IssueTabProps) {
  const [issuedUser, setIssuedUser] = useState<{ userId: string; displayId: number } | null>(null);

  // スマホ用リストバンド発行 API
  const issueUserMutation = useMutation({
    mutationFn: () => wristbandApi.issue(eventId),
    onSuccess: (data) => {
      setIssuedUser({ userId: data.userId, displayId: data.displayId });
      toast.success("新規来場者アカウントを発行しました");
    },
    onError: (err: any) => {
      toast.error(err.message || "発行に失敗しました");
    },
  });

  const getVisitorLink = (userId: string) => {
    const visitorBase = import.meta.env.VITE_VISITOR_URL || window.location.origin.replace("3000", "3001");
    return `${visitorBase}/w/${userId}`;
  };

  return (
    <div className="space-y-6 font-mono text-foreground">
      <div className="flex justify-between items-center border-b-thick border-border pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Smartphone className="h-4 w-4" />
          スマホ用リストバンド（デジタルQR）の発行
        </h2>
      </div>

      <Card className=" rounded-none bg-background shadow-none">
        <CardHeader className="p-4 pb-2 border-b-thin border-border bg-muted/20">
          <CardTitle className="text-xs uppercase font-bold">[デジタルQRコードの新規生成]</CardTitle>
          <CardDescription className="text-[10px]">
            物理的なリストバンドを使わず、スマートフォンの画面をリストバンドとして利用する来場者向けのアカウントIDをその場で発行します。
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-4 space-y-4">
          <div className="bg-muted/10 p-4 text-center space-y-4">
            <p className="text-[10px] text-muted-foreground uppercase font-mono">
              発行ボタンを押すと、来場者専用のチェックイン用URLとQRコードが生成されます。
            </p>
            <Button
              onClick={() => issueUserMutation.mutate()}
              disabled={issueUserMutation.isPending}
              className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-11 text-xs font-black uppercase rounded-none shadow-none px-6 flex items-center gap-1.5 mx-auto"
            >
              {issueUserMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Smartphone className="h-4 w-4" />
              )}
              スマホ用来場者QRを発行する
            </Button>
          </div>

          {/* 発行されたQRコードの表示 */}
          {issuedUser && (
            <div className="p-6 bg-background space-y-6 text-center max-w-sm mx-auto shadow-none font-mono">
              <div className="space-y-1">
                <span className="bg-primary text-primary-foreground px-2 py-0.5 text-[9px] font-black uppercase tracking-widest inline-block">
                  ONLINE ENTRY QR
                </span>
                <h4 className="text-sm font-black uppercase tracking-wider">スマホチェックイン用QRコード</h4>
                <p className="text-[9px] text-muted-foreground">表示呼び出し番号: #{issuedUser.displayId}</p>
              </div>

              {/* QRコード画像 (SVG) */}
              <div className="bg-background p-4 inline-block border-thick border-border mx-auto">
                <QRCodeSVG
                  value={getVisitorLink(issuedUser.userId)}
                  size={160}
                  level="M"
                  includeMargin={false}
                />
              </div>

              <div className="space-y-2 text-left text-[9px] text-muted-foreground border-t-thick border-border pt-4">
                <p className="break-all select-all"><strong>チェックインURL:</strong><br />{getVisitorLink(issuedUser.userId)}</p>
                <p className="pt-1">
                  ※来場者は、自身のスマートフォンでこのQRコードをスキャンしてアクセスし、ニックネームや生年月日を入力することで、スマホ単体での入場・注文が可能になります。
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
