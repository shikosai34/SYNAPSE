import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { eventApi, circleApi, orderApi, membershipApi } from "@/lib/api";
import { EventAdminGuard, useAuth } from "@/hooks/useCircleAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2 } from "lucide-react";
import { loadCircleSalesOrders } from "@/features/event-dashboard/sales";

// 切り出したタブコンポーネント
import { CirclesTab } from "@/components/event/CirclesTab";
import { AnalyticsTab } from "@/components/event/AnalyticsTab";
import { BehaviorTab } from "@/components/event/BehaviorTab";
import { OrderMonitorTab } from "@/components/event/OrderMonitorTab";
import { InventoryTab } from "@/components/event/InventoryTab";
import { AnnounceTab } from "@/components/event/AnnounceTab";
import { SettlementTab } from "@/components/event/SettlementTab";
import { DailyCloseTab } from "@/components/event/DailyCloseTab";
import { LotteryTab } from "@/components/event/LotteryTab";
import { SalesTab } from "@/components/event/SalesTab";
import { StaffTab } from "@/components/event/StaffTab";
import { SettingsTab } from "@/components/event/SettingsTab";
import { ContractTab } from "@/components/event/ContractTab";
import { WristbandsTab } from "@/components/event/WristbandsTab";
import { ExportTab } from "@/components/event/ExportTab";
import { EventReviewsTab } from "@/pages/dashboard/Reviews";

export default function EventDashboard() {
  const { eventId } = useAuth();
  const [activeTab, setActiveTab] = useState<string>("circles");
  const [eventName, setEventName] = useState<string>("イベントダッシュボード");

  // イベント情報取得
  const { data: eventData } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventApi.get(eventId!),
    enabled: !!eventId,
  });

  useEffect(() => {
    if (eventData?.eventName) {
      setEventName(eventData.eventName);
    }
  }, [eventData]);

  // サークル一覧取得
  const {
    data: circles,
    isLoading: circlesLoading,
    isError: circlesError,
    error: circlesErrorObj,
    refetch: refetchCircles,
  } = useQuery({
    queryKey: ["circles", eventId],
    queryFn: () => circleApi.list(eventId!),
    // 2026-10-03: 表示していない管理タブの問い合わせを実行しない。
    enabled: !!eventId && (activeTab === "circles" || activeTab === "sales"),
    // 2026-10-07 (#9): 報告から30分を超えた混雑度を本部画面でも未報告へ切り替える。
    refetchInterval: activeTab === "circles" ? 60_000 : false,
  });

  // 2026-10-03: 注文全件は売上タブの表示時のみ取得し、失敗をゼロ売上として隠さない。
  const {
    data: allCirclesOrders,
    isLoading: ordersLoading,
    isError: ordersError,
    error: ordersErrorObj,
    refetch: refetchOrders,
  } = useQuery({
    queryKey: ["allCirclesOrders", eventId, circles?.map((c) => c.id)],
    queryFn: () => loadCircleSalesOrders(circles ?? [], (circleId) => orderApi.list(circleId)),
    enabled: activeTab === "sales" && !!eventId && !!circles,

  });

  // イベントスタッフ一覧取得
  const {
    data: staffMembers,
    isLoading: staffLoading,
    isError: staffError,
    error: staffErrorObj,
    refetch: refetchStaff,
  } = useQuery({
    queryKey: ["eventStaff", eventId],
    queryFn: () => membershipApi.listByEvent(eventId!),
    enabled: !!eventId && activeTab === "staff",
  });

  // 招待中一覧取得
  const { data: invites } = useQuery({
    queryKey: ["invites", eventId],
    queryFn: () => membershipApi.listInvites(undefined, eventId!),
    enabled: !!eventId && activeTab === "staff",
  });

  if (!eventId) {
    return (
      <EventAdminGuard>
        <div className="container mx-auto p-6 text-center font-mono pt-20 border-thick border-dashed border-border rounded-none max-w-lg">
          <Building2 className="h-8 w-8 mx-auto mb-4 opacity-40 text-foreground" />
          <p className="text-muted-foreground uppercase text-xs font-bold tracking-widest">
            アクティブなイベントが選択されていません。
          </p>
          <p className="text-[10px] text-muted-foreground mt-2">ヘッダーのスペース切り替えから対象のイベントを選択してください。</p>
        </div>
      </EventAdminGuard>
    );
  }

  return (
    <EventAdminGuard>
      <DashboardLayout
        title={eventName}
        subtitle="イベント全体管理"
        type="event"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        lotteryEnabled={!!eventData?.lotteryEnabled}
        eventId={eventId}
      >
        <div className="space-y-6">
          {/* TAB: 契約状況 (オーナー向け・参照専用) */}
          {activeTab === "contract" && <ContractTab eventId={eventId} />}

          {/* TAB: 統計・分析 */}
          {activeTab === "analytics" && <AnalyticsTab eventId={eventId} eventName={eventName} />}
          {activeTab === "reviews" && <EventReviewsTab eventId={eventId} />}
          {activeTab === "behavior" && <BehaviorTab eventId={eventId} />}

          {/* TAB: データエクスポート */}
          {activeTab === "export" && <ExportTab eventId={eventId} />}

          {/* TAB: 注文モニタ */}
          {activeTab === "order-monitor" && <OrderMonitorTab eventId={eventId} />}

          {/* TAB: 在庫・売り切れ */}
          {activeTab === "inventory" && <InventoryTab eventId={eventId} />}

          {/* TAB: 一斉アナウンス */}
          {activeTab === "announce" && <AnnounceTab eventId={eventId} />}

          {/* TAB: 精算 */}
          {activeTab === "settlement" && <SettlementTab eventId={eventId} eventName={eventName} />}

          {/* TAB: 日次締め */}
          {activeTab === "daily-close" && <DailyCloseTab eventId={eventId} eventName={eventName} />}

          {/* TAB: 抽選 (event.lotteryEnabled のとき有効) */}
          {activeTab === "lottery" && <LotteryTab eventId={eventId} />}

          {/* TAB 1: サークル管理 */}
          {activeTab === "circles" && (
            <CirclesTab
              eventId={eventId}
              circles={circles}
              circlesLoading={circlesLoading}
              circlesError={circlesError}
              error={circlesErrorObj}
              onRetry={() => refetchCircles()}
            />
          )}

          {/* TAB 2: 全体売上管理 */}
          {activeTab === "sales" && (
            <SalesTab
              allCirclesOrders={allCirclesOrders}
              ordersLoading={circlesLoading || ordersLoading}
              ordersError={circlesError || ordersError}
              error={circlesErrorObj || ordersErrorObj}
              onRetry={() => circlesError ? refetchCircles() : refetchOrders()}
            />
          )}

          {/* TAB 3: スタッフ管理 */}
          {activeTab === "staff" && (
            <StaffTab
              eventId={eventId}
              staffMembers={staffMembers}
              staffLoading={staffLoading}
              staffError={staffError}
              error={staffErrorObj}
              onRetry={() => refetchStaff()}
              invites={invites}
            />
          )}

          {/* TAB 4: イベント設定 */}
          {activeTab === "settings" && eventData && (
            <SettingsTab
              eventId={eventId}
              event={eventData}
            />
          )}

          {/* TAB 5: リストバンド紛失処理 */}
          {activeTab === "wristbands" && (
            <WristbandsTab
              eventId={eventId}
            />
          )}
        </div>
      </DashboardLayout>
    </EventAdminGuard>
  );
}
