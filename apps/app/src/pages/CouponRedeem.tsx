import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { couponApi, type CouponVerifyResult } from "@/lib/api";
import { useVisitor } from "@/hooks/useVisitor";
import { Button } from "@/components/ui/button";
import { FormField, FormSubmitButton } from "@/components/ui/FormField";
import { toast } from "sonner";
import { Ticket, CheckCircle } from "lucide-react";
import { storeCouponForCircle } from "@/lib/coupon-storage";

// 合言葉入力ページ (2026-09-16, issue #50)。
// サークルから個別にもらった URL (この /visitor/coupon/:slug) を開き、別途伝えられた合言葉を
// 入力すると割引が適用される。ここでの検証は「消費しない」プレビューで、実際の消費(使用回数+1)は
// Menu.tsx から事前オーダーを送信するタイミングでサーバ側が改めて行う。
export default function CouponRedeem() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { userId } = useVisitor();
  const [passphrase, setPassphrase] = useState("");
  const [result, setResult] = useState<CouponVerifyResult | null>(null);

  const verifyMutation = useMutation({
    mutationFn: () => {
      if (!slug) throw new Error("クーポンURLが不正です");
      if (!userId) throw new Error("先にリストバンドの発行(入場)が必要です");
      return couponApi.verify({ slug, passphrase: passphrase.trim(), eventUserId: userId });
    },
    onSuccess: (data) => {
      storeCouponForCircle(data.circleId, {
        slug: slug!,
        passphrase: passphrase.trim(),
        title: data.title,
        kind: data.kind,
        discountAmount: data.discountAmount,
        freeUnits: data.freeUnits,
        menuIds: data.menuIds,
        toppingIds: data.toppingIds,
      });
      setResult(data);
      toast.success("合言葉を確認しました");
    },
    onError: (error: any) => {
      toast.error(error.message || "合言葉が違うか、このクーポンは利用できません");
    },
  });

  return (
    <div className="max-w-xl mx-auto p-sp-3 sm:p-sp-4 text-center font-mono my-12">
      <div className="border-heavy border-border p-sp-5 space-y-sp-4 bg-background">
        <div className="inline-flex items-center justify-center h-14 w-14 border-thick border-border bg-primary text-primary-foreground mx-auto">
          <Ticket className="h-7 w-7" />
        </div>

        {result ? (
          <>
            <h1 className="text-[22px] sm:text-[30px] font-headline uppercase tracking-tight leading-[1.15] text-foreground flex items-center justify-center gap-2">
              <CheckCircle className="h-7 w-7 text-success" />
              確認できました
            </h1>
            <p className="text-[13px] sm:text-[14px] leading-[1.6] text-muted-foreground">
              「{result.title}」—{" "}
              {result.kind === "free_topping"
                ? "対象トッピングが無料"
                : `¥${result.discountAmount?.toLocaleString()}引き`}
              <br />
              メニュー画面の「クーポン」欄から、使うかどうかを選んで注文してください(自動では適用されません)。
            </p>
            <div className="border-t-[3px] border-border pt-sp-4">
              <Button
                onClick={() => navigate(`/visitor/menu?circleId=${result.circleId}`)}
                className="w-full h-12 border-thick border-border bg-primary text-primary-foreground font-mono font-bold uppercase hover:bg-background hover:text-foreground"
              >
                メニューを見て注文する
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[22px] sm:text-[30px] font-headline uppercase tracking-tight leading-[1.15] text-foreground">
              クーポンの<br />合言葉を入力
            </h1>
            <p className="text-[13px] sm:text-[14px] leading-[1.6] text-muted-foreground">
              サークルから伝えられた合言葉を入力してください。
            </p>

            {!userId ? (
              <div className="border-thick border-border bg-muted/30 p-3 space-y-1 text-left">
                <p className="text-xs font-black uppercase tracking-wide text-foreground">
                  先にリストバンドの発行(入場)が必要です
                </p>
                <p className="text-[11px] text-muted-foreground leading-normal">
                  お持ちのリストバンドのQRコードを読み取って入場するか、受付でリストバンドの発行を受けてから、もう一度このURLを開いてください。
                </p>
              </div>
            ) : (
              <div className="text-left space-y-4">
                <FormField
                  id="coupon-passphrase"
                  label="合言葉"
                  required
                  placeholder="合言葉を入力"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
                <FormSubmitButton
                  onClick={() => verifyMutation.mutate()}
                  disabled={!passphrase.trim()}
                  isPending={verifyMutation.isPending}
                  icon={Ticket}
                >
                  適用する
                </FormSubmitButton>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
