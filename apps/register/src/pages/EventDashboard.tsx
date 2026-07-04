import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { eventApi, circleApi, orderApi, membershipApi } from "@/lib/api";
import { EventAdminGuard, useAuth } from "@/hooks/useCircleAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2 } from "lucide-react";

// 切り出したタブコンポーネント
import { CirclesTab } from "@/components/event/CirclesTab";
import { SalesTab } from "@/components/event/SalesTab";
import { StaffTab } from "@/components/event/StaffTab";
import { SettingsTab } from "@/components/event/SettingsTab";
import { WristbandsTab } from "@/components/event/WristbandsTab";
import { IssueTab } from "@/components/event/IssueTab";

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
  const { data: circles, isLoading: circlesLoading } = useQuery({
    queryKey: ["circles", eventId],
    queryFn: () => circleApi.list(eventId!),
    enabled: !!eventId,
  });

  // 全サークルの売上・注文情報の一括取得 (Promise.all)
  const { data: allCirclesOrders, isLoading: ordersLoading } = useQuery({
    queryKey: ["allCirclesOrders", circles?.map((c) => c.id)],
    queryFn: async () => {
      if (!circles) return [];
      return await Promise.all(
        circles.map(async (cir) => {
          try {
            const oList = await orderApi.list(cir.id);
            return { circleId: cir.id, circleName: cir.name, orders: oList };
          } catch (e) {
            console.error(e);
            return { circleId: cir.id, circleName: cir.name, orders: [] };
          }
        })
      );
    },
    enabled: !!circles && circles.length > 0,
  });

  // イベントスタッフ一覧取得
  const { data: staffMembers, isLoading: staffLoading } = useQuery({
    queryKey: ["eventStaff", eventId],
    queryFn: () => membershipApi.listByEvent(eventId!),
    enabled: !!eventId,
  });

  // 招待中一覧取得
  const { data: invites } = useQuery({
    queryKey: ["invites", eventId],
    queryFn: () => membershipApi.listInvites(undefined, eventId!),
    enabled: !!eventId,
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
      >
        <div className="space-y-6">
          {/* TAB 1: サークル管理 */}
          {activeTab === "circles" && (
            <CirclesTab
              eventId={eventId}
              circles={circles}
              circlesLoading={circlesLoading}
            />
          )}

          {/* TAB 2: 全体売上管理 */}
          {activeTab === "sales" && (
            <SalesTab
              allCirclesOrders={allCirclesOrders}
              ordersLoading={ordersLoading}
            />
          )}

          {/* TAB 3: スタッフ管理 */}
          {activeTab === "staff" && (
            <StaffTab
              eventId={eventId}
              staffMembers={staffMembers}
              staffLoading={staffLoading}
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

          {/* TAB 6: スマホリストバンド発行 */}
          {activeTab === "issue" && (
            <IssueTab
              eventId={eventId}
            />
          )}
        </div>
      </DashboardLayout>
    </EventAdminGuard>
  );
}
