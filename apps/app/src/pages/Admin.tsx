import { useState } from "react";
import { SystemAdminGuard } from "@/hooks/useCircleAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { AccountsTab } from "@/components/system/AccountsTab";
import { AnnouncementsTab } from "@/components/system/AnnouncementsTab";
import { SystemSettingsTab } from "@/components/system/SystemSettingsTab";
import { OverviewTab } from "@/components/system/OverviewTab";
import { SaasEventsTab } from "@/components/system/SaasEventsTab";
import { AuditTab } from "@/components/system/AuditTab";

// システム管理コンソール (SaaS 運営)。
// 2026-07-12 (Phase C): 旧「イベント一覧」(eventApi.list で自分の所属イベントを出す) を
// 廃し、テナント横断の運営ビュー (運営ダッシュボード / イベント・課金) に置き換えた。
// ここは「運営情報」= 契約状態・集計・名簿のみを扱い、テナント内容 (メニュー/注文/売上の
// 中身) には触れない。内容の閲覧は Phase D/E の昇格(sudo)+なりすまし経由に限る。
export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<string>("overview");

  return (
    <SystemAdminGuard>
      <DashboardLayout
        title="SYSTEM ADMIN"
        subtitle="SaaS 運営コンソール"
        type="system"
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "saas-events" && <SaasEventsTab />}
        {activeTab === "audit" && <AuditTab />}
        {activeTab === "accounts" && <AccountsTab />}
        {activeTab === "announcements" && <AnnouncementsTab />}
        {activeTab === "system-settings" && <SystemSettingsTab />}
      </DashboardLayout>
    </SystemAdminGuard>
  );
}
