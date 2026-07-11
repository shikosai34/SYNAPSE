import type React from "react";
import { Link } from "react-router-dom";
import { PRODUCT_NAME } from "@fesflow/config";
import { ArrowRight, UtensilsCrossed, QrCode, ShoppingBag } from "lucide-react";

/**
 * ドメインルート (/) のブランディングページ (2026-07-11)。
 *
 * 来場者アプリの機能は /visitor/* に集約したため、ルートはプロダクトの顔となる
 * ブランドランディングにする。主導線は「来場者の方はこちら」(/visitor)、
 * スタッフ・管理者はログインへ誘導する。VisitorHeader は付けない (marketing 面)。
 */
export default function Branding() {
  return (
    <div className="min-h-svh flex flex-col font-mono bg-background text-foreground">
      {/* ヒーロー */}
      <div className="flex-1 flex items-center">
        <div className="mx-auto max-w-3xl w-full px-4 py-16 sm:py-24">
          <span className="text-[11px] font-black uppercase tracking-[4px] text-muted-foreground">
            学園祭 モバイルオーダー
          </span>

          <h1 className="mt-4 font-headline uppercase leading-[0.95] tracking-tight">
            <span className="block text-5xl sm:text-7xl md:text-8xl font-black">
              {PRODUCT_NAME}
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-sm sm:text-base leading-relaxed text-muted-foreground">
            模擬店のメニューを見て、事前注文して、マイQRで受け取る。
            学園祭の「買う・受け取る」をスマホひとつでスムーズにする来場者向けサービスです。
          </p>

          {/* 特徴 3点 */}
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <Feature icon={UtensilsCrossed} title="メニュー閲覧" desc="出店とメニューを自由に下見。" />
            <Feature icon={ShoppingBag} title="事前注文" desc="並ばずに注文、店頭で受け取り。" />
            <Feature icon={QrCode} title="マイQR" desc="スマホの画面がそのまま受け取り証。" />
          </div>

          {/* 主導線 */}
          <div className="mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <Link
              to="/visitor"
              className="group inline-flex items-center gap-2 border-[3px] border-border bg-primary text-primary-foreground px-6 py-3.5 font-black uppercase tracking-wide hover:bg-background hover:text-foreground transition-all"
            >
              来場者の方はこちら
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              to="/login"
              className="text-[11px] font-black uppercase tracking-[1.5px] underline underline-offset-4 text-muted-foreground hover:text-foreground"
            >
              スタッフ・管理者ログイン
            </Link>
          </div>
        </div>
      </div>

      {/* フッター */}
      <div className="border-t-[3px] border-border px-4 py-4">
        <div className="mx-auto max-w-3xl flex items-center justify-between text-[10px] uppercase tracking-[2px] text-muted-foreground">
          <span className="font-black">{PRODUCT_NAME}</span>
          <span>© {PRODUCT_NAME}</span>
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="border-[3px] border-border p-3 bg-background">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-xs font-black uppercase tracking-wide">{title}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}
