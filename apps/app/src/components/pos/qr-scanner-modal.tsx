
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import jsQR from "jsqr";
import { Scanner, type IDetectedBarcode, type IScannerError } from "@yudiel/react-qr-scanner";
import "@/lib/qr-wasm";
import { preOrderApi, wristbandApi, type PreOrderWithDetails } from "@/lib/api";
import { extractIdFromCode } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { QrCode, X, CheckCircle2, Search, Camera } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// 2026-10-20: 来場者QRと物理バンドを取り違えないよう、スキャン結果にバンド状態も渡す。
interface QrScannerModalProps {
  circleId: string;
  isOpen: boolean;
  onClose: () => void;
  onOrderClaimed?: (orderNumber: string) => void;
  mode?: "pre_order" | "customer";
  onCustomerScanned?: (userId: string, wristbandId: string | null, familyBandCount: number, allergies: string | null, wristbandStatus?: string | null) => void;
}

export function QrScannerModal({
  circleId,
  isOpen,
  onClose,
  onOrderClaimed,
  mode = "pre_order",
  onCustomerScanned,
}: QrScannerModalProps) {
  useBodyScrollLock(isOpen);
  const [scannedCode, setScannedCode] = useState("");
  const [preOrders, setPreOrders] = useState<PreOrderWithDetails[]>([]);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [fallbackMode, setFallbackMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 連続検出で同じコードを何度も submit しないためのロック
  const lockedRef = useRef(false);
  const [showManualInput, setShowManualInput] = useState(false);

  // 写真から読み取るフォールバック (WKWebView等向け)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCameraActive(false);
    toast.info("画像を解析中...");

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_SIZE = 1000;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        
        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const result = jsQR(imageData.data, width, height, { inversionAttempts: "dontInvert" });
        
        if (result && result.data) {
          const code = result.data.trim();
          setScannedCode(code);
          if (mode === "customer") {
            lookupCustomerMutation.mutate(code);
          } else {
            searchMutation.mutate(code);
          }
        } else {
          toast.error("QRコードを検出できませんでした。はっきりと写るように再度撮影してください。");
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCameraBtnClick = () => {
    if (isCameraActive) {
      setIsCameraActive(false);
      return;
    }
    if (fallbackMode || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      fileInputRef.current?.click();
      return;
    }
    lockedRef.current = false;
    setIsCameraActive(true);
  };

  useEffect(() => {
    if (isOpen) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setFallbackMode(true);
        toast.info("カメラが直接起動できない環境です。写真撮影モードに切り替えました。もう一度カメラボタンを押してください。");
      } else {
        lockedRef.current = false;
        setIsCameraActive(true);
      }
    } else {
      setIsCameraActive(false);
      setScannedCode("");
      setPreOrders([]);
      setShowManualInput(false);
    }
  }, [isOpen]);

  // 2026-10-23: 読み取り高速化のため、自前の jsQR フレームループ (canvas 縮小 + 50ms 間引き) をやめ、
  // @yudiel/react-qr-scanner に置き換えた。ネイティブ BarcodeDetector があればそれを、
  // 無ければ zxing-wasm を使うので、メインスレッドで JS デコードするより速く、縮小による精度低下もない。
  // カメラの起動・停止・ストリーム解放は <Scanner> のマウント/アンマウントに任せる。
  const handleScan = (codes: IDetectedBarcode[]) => {
    const raw = codes[0]?.rawValue?.trim();
    if (!raw || lockedRef.current) return;
    // 一度検出したらロックして重複 submit を防ぎ、カメラを止めてから照会
    lockedRef.current = true;
    setScannedCode(raw);
    setIsCameraActive(false);
    if (mode === "customer") {
      lookupCustomerMutation.mutate(raw);
    } else {
      searchMutation.mutate(raw);
    }
  };

  const handleCameraError = (err: IScannerError) => {
    console.error("Camera error:", err);
    setIsCameraActive(false);
    if (err.kind === "permission-denied" || err.kind === "no-camera") {
      setFallbackMode(true);
      toast.info("カメラが直接起動できない環境です。写真撮影モードに切り替えました。もう一度カメラボタンを押してください。");
    } else {
      toast.error("カメラの起動に失敗しました。キーボードまたはスキャナー入力をご利用ください");
    }
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
          onCustomerScanned(data.user.id, data.wristband?.id || null, data.familyBandCount ?? 0, data.user.allergies ?? null, data.wristband?.status ?? null);
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

  // 2026-10-21: カメラ付きスキャナーも親の overflow/stacking context から独立させる。
  return createPortal((
    // 2026-10-20: 新しい登録フォームからも使うため、スキャナーを読み上げ可能なモーダルとして明示する。
    <div role="dialog" aria-modal="true" aria-labelledby="qr-scanner-title" className="viewport-safe-area fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-foreground/80 backdrop-blur-sm">
      {/* RawBlock モーダルコンテナ */}
      <div className="relative max-h-full w-full min-w-0 max-w-2xl overflow-y-auto overscroll-contain border-heavy border-border bg-background p-3 shadow-none sm:p-6">
        {/* ヘッダー */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between border-b-thick border-border pb-4">
          <div className="flex items-center space-x-2 sm:space-x-3">
            <div className="bg-primary p-2 text-primary-foreground">
              <QrCode className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <h2 id="qr-scanner-title" className="min-w-0 break-words font-mono text-lg sm:text-2xl font-black uppercase tracking-wider">
              {mode === "customer" ? "[顧客特定 - QR / リストバンド]" : "[QR / リストバンド照会]"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="QRスキャナーを閉じる"
            className="border-thick border-border bg-background p-1 hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {/* カメラ/スキャナー入力エリア */}
        <div className="mb-6 space-y-4">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileUpload}
          />

          {/*
            カメラプレビュー: 2026-10-23
            <Scanner> は isCameraActive の間だけマウントする。アンマウントでカメラが確実に解放される。
            formats を qr_code のみに絞るとデコード対象が減って速い (リストバンド/来場者コードは QR のみ)。
            解像度は理想値 1280x720 に留める。高解像度にしてもデコードが遅くなるだけで読み取りは改善しない。
          */}
          {isCameraActive && (
            <div className="relative w-full aspect-[4/3] sm:aspect-video overflow-hidden border-thick border-border bg-primary">
              <Scanner
                onScan={handleScan}
                onError={handleCameraError}
                formats={["qr_code"]}
                constraints={{
                  facingMode: "environment",
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                }}
                scanDelay={0}
                retryDelay={0}
                sound={false}
                components={{ finder: false }}
                styles={{ container: { width: "100%", height: "100%" } }}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="h-48 w-48 sm:h-64 sm:w-64 border-4 border-dashed border-red-500 animate-pulse" />
              </div>
            </div>
          )}

          {!isCameraActive && (
            <div className="flex flex-col items-center justify-center p-8 border-thick border-dashed border-border bg-muted space-y-4">
              <p className="text-sm font-mono text-muted-foreground text-center">
                カメラが停止しています。
              </p>
              <Button onClick={handleCameraBtnClick} className="border-thick border-border bg-primary text-primary-foreground font-bold hover:bg-background hover:text-foreground shadow-none">
                <Camera className="mr-2 h-5 w-5" />
                カメラを起動する
              </Button>
            </div>
          )}

          {/* 手入力エリアのトグル */}
          {!showManualInput ? (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground h-auto p-2"
                onClick={() => {
                  setShowManualInput(true);
                  setTimeout(() => inputRef.current?.focus(), 100);
                }}
              >
                手入力 / バーコードリーダーを使う
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 pt-2 border-t-thick border-dashed border-border mt-4">
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
                  className="flex-1 sm:flex-none h-14 border-thick border-border bg-primary px-6 font-mono text-base font-bold uppercase text-primary-foreground rounded-none hover:bg-background hover:text-foreground shadow-none"
                >
                  <Search className="mr-2 h-5 w-5" />
                  照会
                </Button>
              </div>
            </form>
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
  ), document.body);
}
