import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PRODUCT_NAME } from "@fesflow/config";

// Next.js app/page.tsx から移植 (2026-07-04)。next/link → react-router、
// 製品名は @fesflow/config の PRODUCT_NAME を参照するよう変更。
export default function Home() {
  const features = [
    {
      title: "メニュー閲覧",
      description: "QRコードからアクセスして簡単にメニューを確認",
      href: "/visitor/menu",
      tag: "CUSTOMER",
      index: "01",
    },
    {
      title: "レジシステム",
      description: "直感的な操作で素早く注文を入力",
      href: "/circle/register",
      tag: "POS",
      index: "02",
    },
    {
      title: "厨房管理",
      description: "注文をリアルタイムで確認・管理",
      href: "/circle/backyard",
      tag: "KITCHEN",
      index: "03",
    },
    {
      title: "売上分析",
      description: "売上データを一目で確認",
      href: "/circle/dashboard/sales",
      tag: "ANALYTICS",
      index: "04",
    },
  ];

  return (
    <div className="bg-background text-foreground font-body">
      {/* ヒーローセクション */}
      <section className="border-b-heavy border-border py-sp-6 sm:py-sp-7 px-sp-3 sm:px-sp-4 bg-background">
        <div className="max-w-5xl mx-auto text-center space-y-sp-4 sm:space-y-sp-5">
          <div className="inline-block bg-accent text-accent-foreground font-headline uppercase text-[10px] sm:text-[12px] tracking-[3px] px-sp-3 py-sp-2 border-thick border-accent">
            {PRODUCT_NAME.toUpperCase()} // SYSTEM v1.0
          </div>
          {/* 製品名をロゴ的に大きく表示 (2026-07-04 ユーザー要望)。
              PRODUCT_NAME を参照するので名称変更にも追従する。 */}
          <h1 className="text-[64px] sm:text-[96px] md:text-[128px] lg:text-[160px] font-headline uppercase tracking-[-3px] sm:tracking-[-5px] leading-[0.85] text-foreground">
            {PRODUCT_NAME}
          </h1>
          <p className="font-headline uppercase text-[12px] sm:text-[16px] tracking-[6px] text-foreground/70">
            学園祭 注文システム
          </p>
          <p className="text-[14px] sm:text-[16px] md:text-[18px] font-mono max-w-3xl mx-auto leading-[1.6] text-foreground">
            学園祭での注文管理を、もっとスマートに。
            <span className="hidden sm:inline"><br />無駄を削ぎ落としたリアルタイムPOS/KITCHENソリューション。</span>
          </p>
          <div className="flex flex-col sm:flex-row gap-sp-3 justify-center items-stretch sm:items-center pt-sp-3">
            <Link to="/login" className="w-full sm:w-auto">
              <Button size="lg" variant="accent" className="w-full sm:w-auto">
                ログインして始める
              </Button>
            </Link>
            <Link to="/visitor/menu" className="w-full sm:w-auto">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                メニューを見る
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* 機能紹介 */}
      <section className="py-sp-6 sm:py-sp-7 px-sp-3 sm:px-sp-4 border-b-heavy border-border bg-muted">
        <div className="max-w-6xl mx-auto space-y-sp-4 sm:space-y-sp-5">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end border-b-thick border-border pb-sp-3 gap-1">
            <h2 className="text-[28px] sm:text-[32px] md:text-[48px] font-headline uppercase tracking-tight leading-[1.05]">
              主な機能
            </h2>
            <span className="font-mono text-[11px] sm:text-[13px] uppercase font-bold tracking-[1px]">
              [04 CORE MODULES]
            </span>
          </div>
          <div className="grid gap-sp-3 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="bg-background border-thick border-border p-sp-4 flex flex-col justify-between hover:bg-primary hover:text-primary-foreground group"
              >
                <div>
                  <div className="flex items-center justify-between mb-sp-3 sm:mb-sp-4">
                    <span className="font-mono text-[24px] sm:text-[28px] font-bold leading-none">
                      {feature.index}
                    </span>
                    <span className="font-mono text-[10px] font-bold uppercase border-thin border-border group-hover:border-primary-foreground px-sp-2 py-sp-1 tracking-[1px]">
                      {feature.tag}
                    </span>
                  </div>
                  <h3 className="text-[20px] sm:text-[24px] font-headline uppercase mb-sp-2 leading-[1.1]">
                    {feature.title}
                  </h3>
                  <p className="font-body text-[13px] sm:text-[14px] leading-[1.5] mb-sp-3 sm:mb-sp-4">
                    {feature.description}
                  </p>
                </div>
                <Link to={feature.href} className="block w-full mt-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-between group-hover:bg-background group-hover:text-foreground group-hover:border-background"
                  >
                    アクセス
                    <span className="font-mono font-bold">→</span>
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-sp-6 sm:py-sp-7 px-sp-3 sm:px-sp-4 bg-primary text-primary-foreground">
        <div className="max-w-4xl mx-auto border-heavy border-primary-foreground p-sp-4 sm:p-sp-5 md:p-sp-7 text-center space-y-sp-4 sm:space-y-sp-5 bg-primary">
          <h2 className="text-[28px] sm:text-[32px] md:text-[48px] font-headline uppercase tracking-tight leading-[1.05]">
            GET STARTED NOW
          </h2>
          <p className="text-[14px] sm:text-[16px] md:text-[18px] font-mono max-w-xl mx-auto leading-[1.5]">
            イベント名とサークル名を選択し、PINコードで瞬時にログイン可能。
          </p>
          <div>
            <Link to="/login" className="block sm:inline-block">
              <Button
                size="lg"
                variant="accent"
                className="w-full sm:w-auto border-thick border-transparent"
              >
                ログイン画面へ進む
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
