import { useEffect, useState, useRef } from "react";
import {
  CircleAuthGuard,
  PermissionGuard,
  useAuth,
} from "@/hooks/useCircleAuth";
import { useQuery } from "@tanstack/react-query";
import { circleApi } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  Printer,
  ArrowLeft,
  Smartphone,
  FileDown,
  ImageIcon,
  Loader2,
  Download,
} from "lucide-react";
import { VISITOR_BASE_URL } from "@/lib/visitor-url";
import { QRCodeSVG } from "qrcode.react";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function CircleQrContent() {
  const { circleId } = useAuth();
  const [origin, setOrigin] = useState("");
  const [circleName, setCircleName] = useState<string>("サークルダッシュボード");
  const [isExporting, setIsExporting] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
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

  const {
    data: circle,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId!),
    enabled: !!circleId,
  });

  if (isLoading || !circleId) {
    return (
      <DashboardLayout title={circleName} subtitle="モバイルオーダーQR" type="circle">
        <div className="space-y-4 font-mono">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  if (isError) {
    return (
      <DashboardLayout title={circleName} subtitle="モバイルオーダーQR" type="circle">
        <ErrorState error={error} onRetry={() => refetch()} />
      </DashboardLayout>
    );
  }

  // 2026-07-06: 来場者アプリへ直接リンクする。以前は register の /visitor/menu 経由で
  // ExternalRedirect していたが、リダイレクト時に ?circleId が落ちてサークルが特定できず
  // 「メニューが開けない」不具合になっていた。VISITOR_BASE_URL へ直接飛ばして circleId を渡す。
  const mobileOrderUrl = `${VISITOR_BASE_URL}/menu?circleId=${circleId}`;

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPng = async () => {
    if (!popRef.current) return;
    setIsExporting(true);
    toast.info("超高画質PNG画像を生成中...");
    try {
      const dataUrl = await toPng(popRef.current, {
        cacheBust: true,
        pixelRatio: 4,
        backgroundColor: "#ffffff",
        skipFonts: true,
      });
      const link = document.createElement("a");
      link.download = `${circle?.name || "POP"}_MobileOrder.png`;
      link.href = dataUrl;
      link.click();
      toast.success("超高画質PNG画像をダウンロードしました");
    } catch (err) {
      console.error("Failed to export PNG", err);
      toast.error("PNG画像の出力に失敗しました");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!popRef.current) return;
    setIsExporting(true);
    toast.info("超高画質PDFファイルを生成中...");
    try {
      const dataUrl = await toPng(popRef.current, {
        cacheBust: true,
        pixelRatio: 4,
        backgroundColor: "#ffffff",
        skipFonts: true,
      });

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const margin = 10;
      const availableWidth = pdfWidth - margin * 2;

      const img = new window.Image();
      img.src = dataUrl;
      await new Promise((resolve) => {
        img.onload = resolve;
      });

      const imgWidth = availableWidth;
      const imgHeight = (img.height * imgWidth) / img.width;

      pdf.addImage(dataUrl, "PNG", margin, margin, imgWidth, imgHeight);
      pdf.save(`${circle?.name || "POP"}_MobileOrder.pdf`);
      toast.success("PDFファイルをダウンロードしました");
    } catch (err) {
      console.error("Failed to export PDF", err);
      toast.error("PDFファイルの出力に失敗しました");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <DashboardLayout title={circleName} subtitle="モバイルオーダーQR" type="circle">
      <div className="space-y-6 font-mono">
        {/* ナビゲーション・アクション（印刷時には非表示） */}
        <div className="print:hidden flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b-thick border-border pb-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider">[店頭掲示用 モバイルオーダーQR POP]</h2>
            <p className="text-[10px] text-muted-foreground mt-1">
              店頭でこちらを掲示することで、来場者がスムーズに注文できます
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={isExporting}
                  className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-9 text-xs font-bold shadow-none px-3 flex items-center gap-1.5"
                >
                  {isExporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span>POPを出力 / 保存</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56 font-mono border border-border rounded-none shadow-none bg-background"
              >
                <DropdownMenuLabel className="font-bold text-xs">出力形式を選択</DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-border h-[1px]" />
                <DropdownMenuItem
                  onClick={handleDownloadPdf}
                  className="cursor-pointer py-2 text-xs font-bold flex items-center gap-2 hover:bg-neutral-100 rounded-none"
                >
                  <FileDown className="h-4 w-4 text-muted-foreground" />
                  <span>PDFで保存 (.pdf)</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleDownloadPng}
                  className="cursor-pointer py-2 text-xs font-bold flex items-center gap-2 hover:bg-neutral-100 rounded-none"
                >
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  <span>PNG画像で保存 (.png)</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border h-[1px]" />
                <DropdownMenuItem
                  onClick={handlePrint}
                  className="cursor-pointer py-2 text-xs font-bold flex items-center gap-2 hover:bg-neutral-100 rounded-none"
                >
                  <Printer className="h-4 w-4 text-muted-foreground" />
                  <span>印刷ダイアログを開く</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              onClick={handlePrint}
              variant="outline"
              disabled={isExporting}
              className="rounded-none border-thick border-border bg-background text-foreground hover:bg-neutral-100 h-9 text-xs font-bold shadow-none px-3"
            >
              <Printer className="mr-1.5 h-4 w-4" />
              印刷
            </Button>
          </div>
        </div>

        {/* 店頭掲示用 POP シート (印刷対象) */}
        <div
          ref={popRef}
          className="print:m-0 print:p-0 print:border-none print:shadow-none border-thick border-border bg-background p-6 space-y-6 text-center text-foreground max-w-2xl mx-auto rounded-none"
        >
          {/* POP ヘッダー */}
          <div className="bg-primary text-primary-foreground p-5 border-thin border-border space-y-1 rounded-none">
            <span className="bg-background text-foreground px-3 py-0.5 font-mono text-[10px] font-black uppercase tracking-widest inline-block rounded-none border border-border">
              MOBILE ORDER AVAILABLE
            </span>
            <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-wider font-mono leading-none pt-1">
              {circle?.name || "店舗名"}
            </h2>
            <p className="font-mono text-[10px] text-primary-foreground/80 uppercase tracking-widest pt-1">
              スマホで事前注文＆並ばずに即受取！
            </p>
          </div>

          {/* メイン QR 描画エリア */}
          <div className="my-6 flex flex-col items-center justify-center space-y-4">
            <div className="relative border-thick border-border bg-background p-5 rounded-none shadow-[4px_4px_0px_0px_var(--border)]">
              <QRCodeSVG
                value={mobileOrderUrl}
                size={220}
                level="H"
                className="mx-auto block"
              />
            </div>

            <div className="space-y-1.5 max-w-sm mx-auto">
              <div className="flex items-center justify-center gap-1.5 font-mono font-black text-base uppercase">
                <Smartphone className="h-5 w-5" />
                <span>QRコードをカメラでスキャン</span>
              </div>
              <p className="font-mono text-[9px] text-muted-foreground break-all bg-muted p-2 border border-border rounded-none">
                {mobileOrderUrl}
              </p>
            </div>
          </div>

          {/* POP フッターステップ案内 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-left pt-4 border-t-thin border-border">
            <div className="border border-border p-2.5 bg-muted rounded-none">
              <span className="bg-primary text-primary-foreground px-1.5 py-0.5 text-[8px] font-bold mr-1 rounded-none">
                STEP 1
              </span>
              <p className="font-bold text-[11px] mt-1">QRを読み取り</p>
              <p className="text-[9px] text-muted-foreground">メニュー一覧が開きます</p>
            </div>
            <div className="border border-border p-2.5 bg-muted rounded-none">
              <span className="bg-primary text-primary-foreground px-1.5 py-0.5 text-[8px] font-bold mr-1 rounded-none">
                STEP 2
              </span>
              <p className="font-bold text-[11px] mt-1">メニューを選び注文</p>
              <p className="text-[9px] text-muted-foreground">事前オーダーを送信</p>
            </div>
            <div className="border border-border p-2.5 bg-muted rounded-none">
              <span className="bg-primary text-primary-foreground px-1.5 py-0.5 text-[8px] font-bold mr-1 rounded-none">
                STEP 3
              </span>
              <p className="font-bold text-[11px] mt-1">店頭でマイQR提示</p>
              <p className="text-[9px] text-muted-foreground">一瞬で受け取れます</p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function CircleQrPage() {
  return (
    <CircleAuthGuard>
      <PermissionGuard permission="circle:read">
        <CircleQrContent />
      </PermissionGuard>
    </CircleAuthGuard>
  );
}

