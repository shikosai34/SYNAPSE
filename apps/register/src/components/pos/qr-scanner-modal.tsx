
import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import jsQR from "jsqr";
import { preOrderApi, wristbandApi, type PreOrderWithDetails } from "@/lib/api";
import { extractIdFromCode } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { QrCode, X, CheckCircle2, Search, Camera } from "lucide-react";

interface QrScannerModalProps {
  circleId: string;
  isOpen: boolean;
  onClose: () => void;
  onOrderClaimed?: (orderNumber: string) => void;
  mode?: "pre_order" | "customer";
  onCustomerScanned?: (userId: string, wristbandId: string | null) => void;
}

export function QrScannerModal({
  circleId,
  isOpen,
  onClose,
  onOrderClaimed,
  mode = "pre_order",
  onCustomerScanned,
}: QrScannerModalProps) {
  const [scannedCode, setScannedCode] = useState("");
  const [preOrders, setPreOrders] = useState<PreOrderWithDetails[]>([]);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // jsQR デコード用の作業キャンバス (画面には出さない)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // 連続検出で同じコードを何度も submit しないためのロック
  const lockedRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      stopCamera();
      setScannedCode("");
      setPreOrders([]);
    }
  }, [isOpen]);

  // カメラ起動
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      lockedRef.current = false;
      setIsCameraActive(true);
      toast.info("カメラを起動しました。QRコードにかざしてください");
      // フレーム走査ループ開始 (jsQR で実際にデコードする)
      rafRef.current = requestAnimationFrame(scanFrame);
    } catch (err) {
      console.error("Camera error:", err);
      toast.error("カメラの起動に失敗しました。キーボードまたはスキャナー入力をご利用ください");
    }
  };

  // 毎フレーム: video → canvas → jsQR。検出したら該当コードを自動照会する。
  const scanFrame = () => {
    const video = videoRef.current;
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    const canvas = canvasRef.current ?? (canvasRef.current = document.createElement("canvas"));
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const result = jsQR(imageData.data, w, h, { inversionAttempts: "dontInvert" });
    if (result && result.data && !lockedRef.current) {
      // 一度検出したらロックして重複 submit を防ぎ、カメラを止めてから照会
      lockedRef.current = true;
      const code = result.data.trim();
      setScannedCode(code);
      stopCamera();
      if (mode === "customer") {
        lookupCustomerMutation.mutate(code);
      } else {
        searchMutation.mutate(code);
      }
      return;
    }
    rafRef.current = requestAnimationFrame(scanFrame);
  };

  // カメラ停止
  const stopCamera = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  // 顧客情報ルックアップ (2026-07-04)
  const lookupCustomerMutation = useMutation({
    mutationFn: async (code: string) => {
      const parsedCode = extractIdFromCode(code);
      return await wristbandApi.lookup(parsedCode);
    },
    onSuccess: (data) => {
      if (data.user) {
        toast.success(`顧客を特定しました: ${data.wristband?.id || data.user.id}`);
        if (onCustomerScanned) {
          onCustomerScanned(data.user.id, data.wristband?.id || null);
        }
        onClose();
      } else {
        toast.error("ユーザーが見つかりませんでした");
      }
    },
    onError: (error: any) => {
      toast.error(error.message || "照会に失敗しました");
    },
  });

  // 事前オーダー検索
  const searchMutation = useMutation({
    mutationFn: async (code: string) => {
      const parsedCode = extractIdFromCode(code);
      return await preOrderApi.getByCode(parsedCode, circleId);
    },
    onSuccess: (data) => {
      setPreOrders(data);
      if (data.length === 0) {
        toast.warning("未受取の事前オーダーが見つかりませんでした");
      } else {
        toast.success(`${data.length}件の事前オーダーが見つかりました`);
      }
    },
    onError: (error: any) => {
      toast.error(error.message || "照会に失敗しました");
    },
  });

  // 受取確定処理
  const claimMutation = useMutation({
    mutationFn: async (preOrderId: string) => {
      return await preOrderApi.claim(preOrderId);
    },
    onSuccess: (data) => {
      toast.success(`受取確定！ 注文番号: ${data.orderNumber}`, {
        style: {
          border: "3px solid var(--border)",
          borderRadius: "var(--radius)",
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          fontWeight: "bold",
        },
      });
      if (onOrderClaimed) {
        onOrderClaimed(data.orderNumber);
      }
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.message || "受取確定に失敗しました");
    },
  });

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!scannedCode.trim()) return;
    if (mode === "customer") {
      lookupCustomerMutation.mutate(scannedCode.trim());
    } else {
      searchMutation.mutate(scannedCode.trim());
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/80 p-4 backdrop-blur-sm">
      {/* RawBlock モーダルコンテナ */}
      <div className="relative w-full max-w-2xl border-heavy border-border bg-background p-4 sm:p-6 shadow-none">
        {/* ヘッダー */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between border-b-thick border-border pb-4">
          <div className="flex items-center space-x-2 sm:space-x-3">
            <div className="bg-primary p-2 text-primary-foreground">
              <QrCode className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <h2 className="font-mono text-lg sm:text-2xl font-black uppercase tracking-wider">
              {mode === "customer" ? "[顧客特定 - QR / リストバンド]" : "[QR / リストバンド照会]"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="border-thick border-border bg-background p-1 hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* カメラ/スキャナー入力エリア */}
        <div className="mb-6 space-y-4">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Label htmlFor="qrInput" className="sr-only">
                リストバンドID / ユーザーID
              </Label>
              <Input
                id="qrInput"
                ref={inputRef}
                type="text"
                placeholder="リストバンドQRをスキャン / コード入力..."
                className="h-14 w-full border-thick border-border bg-input font-mono text-sm sm:text-lg rounded-none focus-visible:border-heavy focus-visible:ring-0"
                value={scannedCode}
                onChange={(e) => setScannedCode(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={searchMutation.isPending}
                className="flex-1 sm:flex-none h-14 border-thick border-border bg-primary px-6 font-mono text-base font-bold uppercase text-primary-foreground rounded-none hover:bg-background hover:text-foreground"
              >
                <Search className="mr-2 h-5 w-5" />
                照会
              </Button>
              <Button
                type="button"
                onClick={isCameraActive ? stopCamera : startCamera}
                className="h-14 border-thick border-border bg-background px-4 text-foreground rounded-none hover:bg-primary hover:text-primary-foreground"
              >
                <Camera className="h-5 w-5" />
              </Button>
            </div>
          </form>

          {/* カメラプレビュー */}
          {isCameraActive && (
            <div className="relative h-48 w-full overflow-hidden border-thick border-border bg-primary">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                playsInline
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-32 w-32 border-thick border-dashed border-red-500 animate-pulse" />
              </div>
            </div>
          )}
        </div>

        {/* 検索結果リスト */}
        <div className="max-h-[350px] overflow-y-auto space-y-4 pr-1">
          {(searchMutation.isPending || lookupCustomerMutation.isPending) && (
            <div className="py-8 text-center font-mono font-bold uppercase">
              {mode === "customer" ? "特定中..." : "照会中..."}
            </div>
          )}

          {!searchMutation.isPending && !lookupCustomerMutation.isPending && preOrders.length === 0 && (
            <div className="border-thick border-dashed border-border p-8 text-center font-mono text-muted-foreground">
              {mode === "customer"
                ? "顧客のリストバンドQRコードをカメラにかざすか、コードを入力して「照会」してください。"
                : "リストバンドQRコードをスキャンするか、IDを入力して「照会」を押してください。"}
            </div>
          )}

          {preOrders.map((po) => (
            <div
              key={po.id}
              className="border-thick border-border bg-background p-4 sm:p-5 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start border-b-thin border-border pb-3 gap-2 sm:gap-0">
                <div>
                  <span className="bg-primary text-primary-foreground px-2 py-1 font-mono text-xs font-bold uppercase tracking-widest">
                    事前オーダー
                  </span>
                  <p className="font-mono text-xs text-gray-600 mt-1 sm:mt-2">
                    ID: {po.id} | 登録: {new Date(po.createdAt).toLocaleTimeString("ja-JP")}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <span className="font-mono text-2xl font-black">
                    ¥{po.totalPrice.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* 注文アイテム明細 */}
              <div className="space-y-2 bg-muted p-3 border-thin border-border">
                <p className="font-mono text-xs font-bold uppercase tracking-wider">
                  [注文内容]
                </p>
                <ul className="divide-y divide-border/20 font-mono text-sm">
                  {po.items.map((item) => (
                    <li key={item.id} className="py-1.5 flex justify-between">
                      <span className="font-bold">{item.menu?.name || "メニュー"}</span>
                      <span>x {item.quantity}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 確定ボタン */}
              <Button
                onClick={() => claimMutation.mutate(po.id)}
                disabled={claimMutation.isPending}
                className="w-full h-12 sm:h-14 border-thick border-border bg-primary font-mono text-base sm:text-lg font-black uppercase text-primary-foreground rounded-none hover:bg-success hover:text-primary-foreground transition-all shadow-none active:translate-y-1"
              >
                <CheckCircle2 className="mr-2 h-5 w-5 sm:h-6 sm:w-6" />
                {claimMutation.isPending ? "処理中..." : "【受取確定＆調理開始】"}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
