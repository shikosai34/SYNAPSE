import { useNavigate } from "react-router-dom";
import { QrCode, Store, CalendarCog, ArrowRight } from "lucide-react";
import { PRODUCT_NAME } from "@fesflow/config";

/**
 * トップ / 入口ポータル (2026-07-04)。
 * apex ドメイン (fesflow.shikosai.net) のトップ。来場者・サークルスタッフ・イベント管理の
 * 3つの入口を提示し、スタッフ/管理はそれぞれのサブドメインへ移動してログインする流れ。
 */
const STAFF_URL = (import.meta.env.VITE_STAFF_URL as string) || "http://localhost:3000";
const ADMIN_URL = (import.meta.env.VITE_ADMIN_URL as string) || "http://localhost:3000";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 font-mono">
      <div className="space-y-2 mb-8">
        <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
          {PRODUCT_NAME.toUpperCase()}
        </span>
        <h1 className="font-headline text-3xl sm:text-4xl font-black uppercase tracking-tight leading-tight">
          FesFlow へようこそ
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          ご利用の機能を選んでください。スタッフ・管理者は各専用ページへ移動してログインします。
        </p>
      </div>

      <div className="grid gap-4">
        {/* 来場者: メニューの下見は自由。利用にはリストバンド発行(入場)が必要 */}
        <PortalCard
          icon={QrCode}
          title="来場者"
          desc="学園祭を楽しむ方。メニューの下見はどなたでもご覧いただけます。事前注文・スタンプ・抽選・マイページを使うには、受付でリストバンドの発行を受けるか、お持ちのリストバンドのQRを読み取って入場してください。"
          cta="メニューを見る"
          onClick={() => navigate("/events")}
          primary
        />

        {/* サークルスタッフ: staff サブドメインへ */}
        <PortalCard
          icon={Store}
          title="サークルスタッフ"
          desc="模擬店の注文受付・厨房・売上管理を行う方。スタッフ用ページでログインします。"
          cta="スタッフページへ"
          onClick={() => {
            window.location.href = `${STAFF_URL}/login`;
          }}
        />

        {/* イベント管理: admin サブドメインへ */}
        <PortalCard
          icon={CalendarCog}
          title="イベント管理"
          desc="イベント全体やシステムを管理する方。管理者用ページでログインします。"
          cta="管理ページへ"
          onClick={() => {
            window.location.href = `${ADMIN_URL}/login`;
          }}
        />
      </div>
    </div>
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
      className={`group text-left border-[3px] border-border p-5 transition-all hover:bg-muted flex flex-col gap-3 ${
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
        <span className="font-headline text-xl font-black uppercase tracking-tight">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
      <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider">
        {cta}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
      </span>
    </button>
  );
}
