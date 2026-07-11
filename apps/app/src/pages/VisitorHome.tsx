import type React from "react";
import { useNavigate } from "react-router-dom";
import { QrCode, UtensilsCrossed, ShoppingBag, ArrowRight, Store, CalendarCog } from "lucide-react";
import { PRODUCT_NAME } from "@fesflow/config";
import { useVisitor } from "@/hooks/useVisitor";

/**
 * トップ / 入口ポータル (2026-07-11 来場者ファーストに再構成)。
 * apex ドメインのトップ。従来は来場者・スタッフ・イベント管理の3入口を対等に並べていたが、
 * 実際の主対象は来場者なので、来場者導線 (メニュー閲覧 / マイページ) と「初めての方へ」ガイドを
 * 主役にし、スタッフ・管理者の入口は末尾に控えめに置く。
 */
export default function Home() {
  const navigate = useNavigate();
  // 入場済み (リストバンド/QR発行済み) の来場者には「マイページ」を主導線として出す
  const { isEntered } = useVisitor();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-12 font-mono">
      <div className="space-y-2 mb-6">
        <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
          {PRODUCT_NAME.toUpperCase()}
        </span>
        <h1 className="font-headline text-2xl sm:text-3xl md:text-4xl font-black uppercase tracking-tight leading-tight">
          FesFlow へようこそ
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          学園祭の模擬店メニューを見て、事前注文やマイQRが使えるモバイルサービスです。
        </p>
      </div>

      {/* 初めての方へ: 3ステップで使い方を提示する (初見でも操作イメージが湧くように) */}
      <div className="border-[3px] border-border bg-muted/30 p-4 sm:p-5 mb-6">
        <div className="text-[11px] font-black uppercase tracking-[2px] text-muted-foreground mb-3">
          初めての方へ / HOW IT WORKS
        </div>
        <ol className="grid gap-3 sm:grid-cols-3">
          <GuideStep n={1} icon={UtensilsCrossed} title="メニューを見る" desc="出店とメニューはどなたでも自由に閲覧できます。" />
          <GuideStep n={2} icon={QrCode} title="入場する" desc="受付でリストバンドを受け取るか、お持ちのQRを読み取って入場。" />
          <GuideStep n={3} icon={ShoppingBag} title="事前注文・マイQR" desc="入場すると事前注文やマイQRの提示が使えます。" />
        </ol>
      </div>

      {/* 来場者の主導線 */}
      <div className="grid gap-4">
        <PortalCard
          icon={UtensilsCrossed}
          title="メニュー・出店を見る"
          desc="開催中のイベントと模擬店のメニューを見る。事前注文もこちらから。"
          cta="出店一覧を見る"
          onClick={() => navigate("/visitor/events")}
          primary
        />

        <PortalCard
          icon={QrCode}
          title="マイページ / マイQR"
          desc={isEntered
            ? "あなたのマイQR・リストバンド状態・注文履歴を確認します。"
            : "入場済みの方向け。マイQRの提示や注文履歴の確認ができます。"}
          cta={isEntered ? "マイページを開く" : "マイページへ"}
          onClick={() => navigate("/visitor/mypage")}
        />
      </div>

      {/* スタッフ・管理者の入口 (来場者導線と分離して末尾に控えめに配置) */}
      <div className="mt-8 border-t-[3px] border-border pt-4">
        <div className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground mb-2">
          スタッフ・管理者の方
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <StaffLink
            icon={Store}
            label="サークルスタッフページ"
            onClick={() => navigate("/login?url=/circle/dashboard")}
          />
          <StaffLink
            icon={CalendarCog}
            label="イベント・システム管理"
            onClick={() => navigate("/login?url=/event/dashboard")}
          />
        </div>
      </div>
    </div>
  );
}

function GuideStep({
  n,
  icon: Icon,
  title,
  desc,
}: {
  n: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center border-[2px] border-border bg-primary text-primary-foreground text-[11px] font-black shrink-0">
          {n}
        </span>
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-xs font-black uppercase tracking-wide leading-tight">{title}</span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
    </li>
  );
}

function PortalCard({
  icon: Icon,
  title,
  desc,
  cta,
  onClick,
  primary,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  cta: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`group text-left border-[3px] border-border p-4 sm:p-5 transition-all hover:bg-muted flex flex-col gap-2 sm:gap-3 ${
        primary ? "bg-primary/5" : "bg-background"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center border-[2px] border-border shrink-0 ${
            primary ? "bg-primary text-primary-foreground" : "bg-background"
          }`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="font-headline text-lg sm:text-xl font-black uppercase tracking-tight leading-tight">{title}</span>
      </div>
      <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">{desc}</p>
      <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider">
        {cta}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
      </span>
    </button>
  );
}

function StaffLink({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 flex items-center justify-between gap-2 border-[2px] border-border bg-background px-3 py-2 text-[11px] font-bold uppercase tracking-wide hover:bg-muted transition-all"
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0" />
    </button>
  );
}
