
import { useEffect, useState, useRef } from "react";
import {
  CircleAuthGuard,
  PermissionGuard,
  useAuth,
} from "@/hooks/useCircleAuth";
import { useQuery } from "@tanstack/react-query";
import { circleApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Printer,
  ArrowLeft,
  Smartphone,
  FileDown,
  Image as ImageIcon,
  Loader2,
  Download,
} from "lucide-react";
import Link from "@/components/link";
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
  const [isExporting, setIsExporting] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const { data: circle, isLoading } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId!),
    enabled: !!circleId,
  });

  if (isLoading || !circleId) {
    return (
      <div className="max-w-4xl mx-auto p-4 space-y-4 font-mono">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const mobileOrderUrl = `${origin}/menu?circleId=${circleId}`;

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
    <div className="max-w-4xl mx-auto p-4 space-y-6 pb-20">
      {/* ナビゲーション・アクション（印刷時には非表示） */}
      <div className="print:hidden flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b-thick border-border pb-4">
        <div>
          <Link
            href="/dashboard"
            className="font-mono text-xs uppercase tracking-widest underline hover:text-info flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            ダッシュボードに戻る
          </Link>
          <h1 className="text-3xl font-black font-mono uppercase tracking-tight">
            [店頭掲示用 モバイルオーダーQR POP]
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={isExporting}
                className="h-12 border-thick border-border bg-primary px-5 font-mono text-base font-bold uppercase text-primary-foreground rounded-none hover:bg-background hover:text-foreground transition-all flex items-center gap-2 shadow-[4px_4px_0px_0px_var(--border)] hover:shadow-none"
              >
                {isExporting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Download className="h-5 w-5" />
                )}
                <span>POPを出力 / 保存</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 font-mono border-thick border-border rounded-none shadow-[4px_4px_0px_0px_var(--border)]"
            >
              <DropdownMenuLabel className="font-bold">出力形式を選択</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-border h-[2px]" />
              <DropdownMenuItem
                onClick={handleDownloadPdf}
                className="cursor-pointer py-3 font-bold flex items-center gap-2 hover:bg-input-hover"
              >
                <FileDown className="h-5 w-5" />
                <span>PDFで保存 (.pdf)</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleDownloadPng}
                className="cursor-pointer py-3 font-bold flex items-center gap-2 hover:bg-input-hover"
              >
                <ImageIcon className="h-5 w-5" />
                <span>PNG画像で保存 (.png)</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border h-[2px]" />
              <DropdownMenuItem
                onClick={handlePrint}
                className="cursor-pointer py-3 font-bold flex items-center gap-2 hover:bg-input-hover"
              >
                <Printer className="h-5 w-5" />
                <span>印刷ダイアログを開く</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            onClick={handlePrint}
            variant="outline"
            disabled={isExporting}
            className="h-12 border-thick border-border bg-background px-4 font-mono text-base font-bold uppercase text-foreground rounded-none hover:bg-primary hover:text-primary-foreground transition-all shadow-[4px_4px_0px_0px_var(--border)] hover:shadow-none"
          >
            <Printer className="mr-2 h-5 w-5" />
            印刷
          </Button>
        </div>
      </div>

      {/* 店頭掲示用 POP シート (印刷対象) */}
      <div
        ref={popRef}
        className="print:m-0 print:p-0 print:border-none print:shadow-none border-[8px] border-border bg-background p-8 space-y-8 text-center text-foreground"
      >
        {/* POP ヘッダー */}
        <div className="bg-primary text-primary-foreground p-6 border-[4px] border-border space-y-2">
          <span className="bg-background text-foreground px-4 py-1 font-mono text-sm font-black uppercase tracking-widest inline-block">
            MOBILE ORDER AVAILABLE
          </span>
          <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-wider font-mono leading-none">
            {circle?.name || "店舗名"}
          </h2>
          <p className="font-mono text-sm text-primary-foreground/80 uppercase tracking-widest">
            スマホで事前注文＆並ばずに即受取！
          </p>
        </div>

        {/* メイン QR 描画エリア */}
        <div className="my-8 flex flex-col items-center justify-center space-y-6">
          <div className="relative border-[6px] border-border bg-background p-6 shadow-[8px_8px_0px_0px_var(--border)]">
            <QRCodeSVG
              value={mobileOrderUrl}
              size={280}
              level="H"
              className="mx-auto block"
            />
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <div className="flex items-center justify-center gap-2 font-mono font-black text-xl sm:text-2xl uppercase">
              <Smartphone className="h-7 w-7" />
              <span>QRコードをカメラでスキャン</span>
            </div>
            <p className="font-mono text-xs text-muted-foreground break-all bg-muted p-2 border-[2px] border-border">
              {mobileOrderUrl}
            </p>
          </div>
        </div>

        {/* POP フッターステップ案内 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-left pt-4 border-t-[4px] border-border">
          <div className="border-thick border-border p-3 bg-muted">
            <span className="bg-primary text-primary-foreground px-2 py-0.5 text-xs font-bold mr-2">
              STEP 1
            </span>
            <p className="font-bold text-sm mt-1">QRを読み取り</p>
            <p className="text-xs text-muted-foreground">メニュー一覧が開きます</p>
          </div>
          <div className="border-thick border-border p-3 bg-muted">
            <span className="bg-primary text-primary-foreground px-2 py-0.5 text-xs font-bold mr-2">
              STEP 2
            </span>
            <p className="font-bold text-sm mt-1">メニューを選び注文</p>
            <p className="text-xs text-muted-foreground">事前オーダーを送信</p>
          </div>
          <div className="border-thick border-border p-3 bg-muted">
            <span className="bg-primary text-primary-foreground px-2 py-0.5 text-xs font-bold mr-2">
              STEP 3
            </span>
            <p className="font-bold text-sm mt-1">店頭でマイQR提示</p>
            <p className="text-xs text-muted-foreground">一瞬で受け取れます</p>
          </div>
        </div>
      </div>
    </div>
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

