
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import Link from "@/components/link";
import { QrCode, Copy, ExternalLink, RefreshCw } from "lucide-react";

export default function TestWristbandsPage() {
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const testBands = [
    { id: "wb_admin_001", name: "⭐ 管理者登録済みリストバンド (ID: #999)" },
    { id: "wb_test_001", name: "テストリストバンド #001 (一般VIP)" },
    { id: "wb_test_002", name: "テストリストバンド #002 (一般)" },
    { id: "wb_test_003", name: "テストリストバンド #003 (スタッフ用)" },
    { id: "wb_test_004", name: "テストリストバンド #004 (予備)" },
    { id: "wb_test_005", name: "テストリストバンド #005 (検証用)" },
  ];


  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`コード "${text}" をコピーしました！`);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6 pb-24 font-mono">
      <div className="border-b-thick border-border pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <span className="bg-primary text-primary-foreground px-2 py-0.5 text-xs font-black uppercase tracking-widest">
            DEV / TESTING TOOL
          </span>
          <h1 className="text-3xl font-black uppercase tracking-tight mt-1">
            [開発用 擬似リストバンドQR一覧]
          </h1>
          <p className="text-xs text-gray-600 mt-1">
            テスト・検証用に利用できる擬似リストバンドのQRコードシミュレーターです。
          </p>
        </div>
        <Link href="/register">
          <Button className="h-12 border-thick border-border bg-primary text-primary-foreground font-bold uppercase rounded-none hover:bg-background hover:text-foreground">
            レジ画面で検証する
          </Button>
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {testBands.map((band) => {
          const checkinUrl = `${origin}/checkin?wb=${band.id}`;
          const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
            checkinUrl
          )}`;

          return (
            <Card
              key={band.id}
              className="border-thick border-border bg-background rounded-none p-4 shadow-none space-y-4 text-center"
            >
              <CardHeader className="p-0 border-b-thin border-border pb-2">
                <CardTitle className="text-base font-bold uppercase">
                  {band.name}
                </CardTitle>
                <p className="text-xs text-gray-500 font-bold">ID: {band.id}</p>
              </CardHeader>

              <CardContent className="p-0 space-y-4 pt-2">
                {/* QRコード画像 */}
                <div className="bg-background p-3 inline-block border-thick border-border">
                  <img
                    src={qrImageUrl}
                    alt={band.id}
                    width={160}
                    height={160}
                    className="mx-auto block"
                  />
                </div>

                <div className="space-y-2">
                  <Button
                    onClick={() => copyToClipboard(band.id)}
                    variant="outline"
                    className="w-full h-10 border-thin border-border bg-background text-foreground text-xs font-bold uppercase rounded-none hover:bg-primary hover:text-primary-foreground"
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    IDコードをコピー (レジ用)
                  </Button>

                  <Link href={`/checkin?wb=${band.id}`} target="_blank">
                    <Button className="w-full h-10 border-thin border-border bg-primary text-primary-foreground text-xs font-bold uppercase rounded-none hover:bg-background hover:text-foreground mt-2">
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      チェックインを試す
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
