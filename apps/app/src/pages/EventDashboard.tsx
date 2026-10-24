import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { eventApi, circleApi, orderApi, membershipApi } from "@/lib/api";
import { EventAdminGuard, getAuthInfo, ROLES, saveAuthInfo, useAuth, useMySpaces } from "@/hooks/useCircleAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, ChevronRight, Store } from "lucide-react";
import { loadCircleSalesOrders } from "@/features/event-dashboard/sales";

// 切り出したタブコンポーネント
import { CirclesTab } from "@/components/event/CirclesTab";
import { AnalyticsTab } from "@/components/event/AnalyticsTab";
import { BehaviorTab } from "@/components/event/BehaviorTab";
import { CongestionTab } from "@/components/event/CongestionTab";
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
import { LostWristbandsTab } from "@/components/event/LostWristbandsTab";
import { StampRedemptionsTab } from "@/components/event/StampRedemptionsTab";
import { StoreAreasTab } from "@/components/event/StoreAreasTab";
import { StampRallyTab } from "@/components/event/StampRallyTab";
import { ExportTab } from "@/components/event/ExportTab";
import { EventReviewsTab } from "@/pages/dashboard/Reviews";

export default function EventDashboard() {
  const navigate = useNavigate();
  const { eventId, role, isLoading: authLoading, isAuthenticated, checkPermission } = useAuth();
  // 2026-10-20: 当日スタッフはイベント画面に入れるが、イベント管理者向けデータ取得は個別に制限する。
  const isEventManager = role === ROLES.EVENT_MANAGER;
  const isEventDashboardRole = isEventManager || role === ROLES.EVENT_STAFF ||
    role === ROLES.EVENT_WRISTBAND_STAFF || role === ROLES.EVENT_STAMP_STAFF;
  const { data: spaces, isLoading: spacesLoading } = useMySpaces();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(() => searchParams.get("tab") || "circles");
  const [eventName, setEventName] = useState<string>("イベントダッシュボード");

  useEffect(() => {
    setActiveTab(searchParams.get("tab") || "circles");
  }, [searchParams]);

  const changeTab = (tab: string) => {
    setActiveTab(tab);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (tab === "circles") next.delete("tab");
      else next.set("tab", tab);
      return next;
    });
  };

  const circleSpaces = (spaces ?? []).filter((space: any) => Boolean(space.circleId));
  const needsCircleSelection = !authLoading && isAuthenticated && !isEventDashboardRole && circleSpaces.length > 0;

  const openCircleDashboard = (space: any) => {
    const current = getAuthInfo();
    if (!current) return;
    // 2026-10-20: イベント管理権限がない利用者には、所属サークルの管理画面を選べる導線を示す。
    // 遷移を先に行い、authChange による旧画面ガードの誤リダイレクトを防ぐ。
    navigate("/circle/dashboard");
    saveAuthInfo({
      ...current,
      circleId: space.circleId,
      eventId: space.eventId ?? null,
      role: space.effectiveRole ?? space.role,
      membershipId: space.id,
      circleName: space.circle?.name ?? space.circleName ?? space.name ?? null,
      isEventAdmin: false,
    });
  };

  // イベント情報取得
  const { data: eventData } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventApi.get(eventId!),
    enabled: !!eventId && isEventDashboardRole,
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
    enabled: !!eventId && isEventManager && (activeTab === "circles" || activeTab === "sales" || activeTab === "store-areas"),
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
    enabled: !!eventId && isEventManager && activeTab === "staff",
  });

  // 招待中一覧取得
  const { data: invites } = useQuery({
    queryKey: ["invites", eventId],
    queryFn: () => membershipApi.listInvites(undefined, eventId!),
    enabled: !!eventId && isEventManager && activeTab === "staff",
  });

  if (needsCircleSelection) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 p-4 py-10 font-mono sm:p-8" role="main">
        <header className="space-y-2 border-b-thick border-border pb-4">
          <Building2 className="h-8 w-8 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-black sm:text-3xl">管理するサークルを選択</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            このアカウントはイベント全体の管理権限を持っていません。管理画面を利用できる所属サークルを選んでください。
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2">
          {circleSpaces.map((space: any) => {
            const name = space.circle?.name ?? space.circleName ?? space.name ?? "サークル";
            return (
              <Card key={space.id} className="border-thick border-border">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Store className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-bold">{name}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{space.eventName ?? space.event?.name ?? "所属サークル"}</p>
                    </div>
                  </div>
                  <Button className="shrink-0" onClick={() => openCircleDashboard(space)}>
                    管理画面へ <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  if (!authLoading && isAuthenticated && !isEventDashboardRole && spacesLoading) {
    return <div className="flex min-h-[200px] items-center justify-center"><Skeleton className="h-20 w-full max-w-xl" /></div>;
  }

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
        onTabChange={changeTab}
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
          {activeTab === "congestion" && <CongestionTab eventId={eventId} />}

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
              eventData={eventData}
              circles={circles}
              circlesLoading={circlesLoading}
              circlesError={circlesError}
              error={circlesErrorObj}
              onRetry={() => refetchCircles()}
            />
          )}

          {activeTab === "store-areas" && eventData && (
            <StoreAreasTab
              eventId={eventId}
              event={eventData}
              circles={circles}
              circlesLoading={circlesLoading}
              circlesError={circlesError}
              circlesErrorObj={circlesErrorObj}
              onRetryCircles={() => refetchCircles()}
            />
          )}

          {activeTab === "stamp-rally" && eventData && (
            <StampRallyTab eventId={eventId} event={eventData} onOpenStoreAreas={() => changeTab("store-areas")} />
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

          {/* 2026-10-20: 紛失対応は通常管理のサブビューにせず、専用タブとして独立させる。 */}
          {activeTab === "wristband-loss" && (
            <LostWristbandsTab eventId={eventId} />
          )}

          {/* TAB 5: リストバンド管理 */}
          {activeTab === "wristbands" && (
            <WristbandsTab
              eventId={eventId}
              hasPhysicalWristband={eventData?.hasPhysicalWristband}
              allowSelfIssue={eventData?.allowSelfIssue}
              canManageWristbands={isEventManager || checkPermission("member:write")}
            />
          )}

          {/* TAB 6: スタンプラリー景品交換 */}
          {activeTab === "stamp-redemptions" && <StampRedemptionsTab eventId={eventId} />}
        </div>
      </DashboardLayout>
    </EventAdminGuard>
  );
}
