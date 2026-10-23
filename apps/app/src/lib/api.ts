import { apiErrorFromResponse, networkApiError } from "./api-error";
import { readAuthContext } from "./auth-context";
import type { RoleType } from "@fesflow/config";
import type { JapaneseAllergen } from "@fesflow/config/allergens";
import type { VisitorAgeGroup } from "@fesflow/config/visitor-profile";
import { createOrderResultSchema, type CreateOrderInput, type CreateOrderResult, type OrderStatus } from "@fesflow/config/order-contract";
import type { RegisterDisplaySnapshot } from "@fesflow/config/register-display-contract";
export type { CreateOrderInput, CreateOrderResult, OrderStatus } from "@fesflow/config/order-contract";

export function getApiBaseUrl(): string {
  let url = import.meta.env.VITE_API_URL || "https://localhost:8787";
  if (typeof window !== "undefined" && (url.includes("localhost") || url.includes("127.0.0.1"))) {
    const host = window.location.hostname;
    if (
      /^192\.168\.\d+\.\d+$/.test(host) ||
      /^10\.\d+\.\d+\.\d+$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)
    ) {
      url = url.replace("localhost", host).replace("127.0.0.1", host).replace("http://", "https://");
    }
  }
  return url;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

async function fetchApi<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, headers = {} } = options;

  const headersObj: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  // タブ別コンテキストからアクティブメンバーシップIDを注入 (2026-07-04 SaaS権限隔離対応、2026-09-27 タブ間分離)
  const authInfo = readAuthContext<{ membershipId?: string | null }>();
  if (authInfo?.membershipId) headersObj["X-Active-Membership-Id"] = authInfo.membershipId;

  const config: RequestInit = {
    method,
    headers: headersObj,
    credentials: "include",
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  // Phase4: 従来は失敗時に必ず `new Error(文字列)` へ潰しており、401/403/429 の区別も
  // バリデーションのフィールド単位エラーもフロントから見えなかった。ここでは
  // レスポンス本文を統一エラーエンベロープとしてパースし、型付きの ApiError を throw する。
  // 呼び出し側 (providers.tsx の共通ハンドラ、または各画面) が ApiError.code / fields /
  // requestId を見て UX を分岐できるようにする。
  let response: Response;
  try {
    const baseUrl = getApiBaseUrl();
    response = await fetch(`${baseUrl}${endpoint}`, config);
  } catch (err) {
    // fetch 自体の失敗 (オフライン・DNS解決失敗等)。ApiError.code = "NETWORK" として区別する。
    if (typeof window !== "undefined") window.dispatchEvent(new Event("fesflow:api-network-failure"));
    throw networkApiError(err);
  }

  // 2026-10-21: HTTP応答を受け取っても5xxは業務API障害として扱い、通信復帰と誤表示しない。
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(response.status >= 500 ? "fesflow:api-server-failure" : "fesflow:api-network-success"));
  }

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  const data = await response.json();
  // メンバーの追加/変更/停止は選択可能な所属も変えるため、useMySpaces に即時再取得を通知する。
  // 対象は成功した書き込みだけに絞り、招待受諾による新規所属も同じ経路で反映する (2026-09-27)。
  if (
    typeof window !== "undefined" &&
    endpoint.startsWith("/api/memberships") &&
    method !== "GET"
  ) {
    window.dispatchEvent(new Event("membershipsChanged"));
  }
  return data;
}

// 権限付きファイルダウンロードも通常APIと同じセッション/アクティブ所属を使う。
async function fetchApiBlob(endpoint: string): Promise<Blob> {
  const headers: Record<string, string> = { Accept: "text/csv" };
  const authInfo = readAuthContext<{ membershipId?: string | null }>();
  if (authInfo?.membershipId) headers["X-Active-Membership-Id"] = authInfo.membershipId;
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${endpoint}`, { headers, credentials: "include" });
  } catch (err) {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("fesflow:api-network-failure"));
    throw networkApiError(err);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(response.status >= 500 ? "fesflow:api-server-failure" : "fesflow:api-network-success"));
  }
  if (!response.ok) throw await apiErrorFromResponse(response);
  return response.blob();
}

// Event API
// 2026-10-08: 来場者の公開イベント一覧と、所属に絞った運営一覧を別エンドポイントにする。
export const eventApi = {
  list: () => fetchApi<PublicEventSummary[]>("/api/festivals/public"),
  get: (id: string) => fetchApi<Event>(`/api/festivals/${id}`),
  // イベント統計・分析 (2026-07-12)。event_manager (sales:read) 権限が必要。
  analytics: (id: string) => fetchApi<EventAnalytics>(`/api/festivals/${id}/analytics`),
  // 来場者行動・混雑・スタッフ分析 (2026-07-14)
  behavior: (id: string) => fetchApi<EventBehavior>(`/api/festivals/${id}/behavior`),
  // 日次締め (指定日 JST の売上を支払い方法別/サークル別に集計)。event_manager sales:read。
  dailyClose: (id: string, date?: string) =>
    fetchApi<DailyClose>(`/api/festivals/${id}/daily-close${date ? `?date=${date}` : ""}`),
  // 抽選機能の有効化トグル (event_manager event:write 権限)。
  setLotteryEnabled: (id: string, enabled: boolean) =>
    fetchApi<{ success: boolean }>(`/api/festivals/${id}/lottery-enabled`, { method: "PUT", body: { enabled } }),
  // エリア単位のスタンプラリー設定 (event_manager event:write 権限)。
  setStampRallySettings: (id: string, settings: StampRallySettings) =>
    fetchApi<{ success: boolean }>(`/api/festivals/${id}/stamp-rally-settings`, { method: "PUT", body: { settings } }),
  setAdvancedPermissions: (id: string, enabled: boolean) =>
    fetchApi<{ success: boolean }>(`/api/festivals/${id}/advanced-permissions`, { method: "PUT", body: { enabled } }),
  // 開催ライフサイクル状態の変更 (event_manager event:write 権限)。
  setLifecycleStatus: (id: string, status: EventLifecycleStatus) =>
    fetchApi<{ success: boolean }>(`/api/festivals/${id}/lifecycle-status`, { method: "PUT", body: { status } }),
  // 契約状況の照会 (オーナー向け・読み取り専用)。
  contract: (id: string) => fetchApi<EventContract>(`/api/festivals/${id}/contract`),
  // 支払い方法の設定 (event_manager event:write 権限)。
  setPaymentMethods: (id: string, paymentMethods: string[]) =>
    fetchApi<{ success: boolean; paymentMethods: string[] }>(`/api/festivals/${id}/payment-methods`, {
      method: "PUT",
      body: { paymentMethods },
    }),
  setStoreAreas: (id: string, storeAreas: EventStoreArea[]) =>
    fetchApi<{ success: boolean; storeAreas: EventStoreArea[] }>(`/api/festivals/${id}/store-areas`, {
      method: "PUT",
      body: { storeAreas },
    }),
  // 進行中注文モニタ (全サークル横断)。event_manager (order:read) 権限が必要。
  liveOrders: (id: string) => fetchApi<LiveOrder[]>(`/api/festivals/${id}/orders/live`),
  // 在庫/売り切れ一覧 (全サークル横断)。event_manager (stock:read) 権限が必要。
  inventory: (id: string) => fetchApi<InventoryItem[]>(`/api/festivals/${id}/inventory`),
  // イベント内スタッフへの一斉アナウンス。event_manager (member:write) 権限が必要。
  announce: (id: string, data: { title: string; message: string }) =>
    fetchApi<{ sent: number }>(`/api/festivals/${id}/announce`, { method: "POST", body: data }),
  // 過去に送信した一斉アナウンスの履歴 (2026-07-16)。event_manager (member:read) 権限。
  announcements: (id: string) =>
    fetchApi<EventAnnouncement[]>(`/api/festivals/${id}/announcements`),
  archivedAnnouncements: (id: string) =>
    fetchApi<EventAnnouncement[]>(`/api/festivals/${id}/announcements?includeDeleted=true`),
  deleteAnnouncement: (id: string, announcementId: string) =>
    fetchApi<{ success: boolean }>(`/api/festivals/${id}/announcements/${announcementId}`, {
      method: "DELETE",
    }),
  restoreAnnouncement: (id: string, announcementId: string) =>
    fetchApi<{ success: boolean }>(`/api/festivals/${id}/announcements/${announcementId}/restore`, {
      method: "POST",
    }),
  create: (data: CreateEventInput) =>
    fetchApi<{ id: string }>("/api/festivals", { method: "POST", body: data }),
  updateTheme: (id: string, data: EventTheme) =>
    fetchApi<Event>(`/api/festivals/${id}/theme`, { method: "PUT", body: data }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/festivals/${id}`, { method: "DELETE" }),
  // 来場者一覧取得 (CSVエクスポート等) - member:read。
  visitors: (id: string) => fetchApi<EventUser[]>(`/api/festivals/${id}/visitors`),
  // 2026-07-07 (Phase 3a/3b): 独自のイベントパスワードログイン (POST /login) は
  // バックエンドで廃止済み。認証は better-auth に一本化。
};


// Circle API
export const circleApi = {
  list: (eventId?: string) =>
    fetchApi<Circle[]>(`/api/circles${eventId ? `?eventId=${eventId}` : ""}`),
  get: (id: string) => fetchApi<Circle>(`/api/circles/${id}`),
  create: (data: CreateCircleInput) =>
    fetchApi<{ id: string }>("/api/circles", { method: "POST", body: data }),
  update: (id: string, data: UpdateCircleInput) =>
    fetchApi<{ success: boolean }>(`/api/circles/${id}`, {
      method: "PUT",
      body: data,
    }),
  updateMods: (id: string, mods: Record<string, any>) =>
    fetchApi<{ success: boolean }>(`/api/circles/${id}/mods`, {
      method: "PATCH",
      body: { mods },
    }),
  updateSettings: (id: string, settings: Record<string, any>) =>
    fetchApi<{ success: boolean }>(`/api/circles/${id}/settings`, {
      method: "PATCH",
      body: { settings },
    }),
  setStoreArea: (id: string, storeAreaId: string | null) =>
    fetchApi<{ success: boolean }>(`/api/circles/${id}/settings`, {
      method: "PATCH",
      body: { settings: { storeAreaId } },
    }),
  // 2026-10-07 (#9): POSスタッフの手動報告は専用エンドポイントで追記し、他の設定と競合させない。
  reportWaitTime: (id: string, waitMinutes: number) =>
    fetchApi<{ success: boolean; waitTimeReport: { minutes: number; reportedAt: string } }>(
      `/api/circles/${id}/wait-time`,
      { method: "PATCH", body: { waitMinutes } },
    ),
  transferOwner: (id: string, membershipId: string) =>
    fetchApi<{ success: boolean }>(`/api/circles/${id}/transfer-owner`, {
      method: "POST",
      body: { membershipId },
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/circles/${id}`, { method: "DELETE" }),
  // サークル統計・分析 (2026-07-13)
  analytics: (id: string) => fetchApi<CircleAnalytics>(`/api/circles/${id}/analytics`),
};

// Menu API
export const menuApi = {
  list: (circleId: string, includeArchived = false) =>
    fetchApi<MenuWithToppings[]>(`/api/menus?circleId=${encodeURIComponent(circleId)}${includeArchived ? "&includeArchived=true" : ""}`),
  get: (id: string) => fetchApi<MenuWithToppings>(`/api/menus/${id}`),
  create: (data: CreateMenuInput) =>
    fetchApi<{ id: string }>("/api/menus", { method: "POST", body: data }),
  update: (id: string, data: UpdateMenuInput) =>
    fetchApi<{ success: boolean }>(`/api/menus/${id}`, {
      method: "PUT",
      body: data,
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/menus/${id}`, { method: "DELETE" }),
  restore: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/menus/${id}/restore`, { method: "POST" }),
  // 在庫の絶対値更新 (在庫>0 で soldOut は自動解除される)。
  // サーバ (menu.ts の PATCH /:id/stock) は stockQuantity を要求する。
  // 以前は { stock } を送っており zBody のバリデーションで常に 400 になっていた。
  // トッピング側と引数名・意味論を揃えておく。
  updateStock: (id: string, stockQuantity: number) =>
    fetchApi<{ success: boolean }>(`/api/menus/${id}/stock`, {
      method: "PATCH",
      body: { stockQuantity },
    }),
  setInventoryEnabled: (id: string, inventoryEnabled: boolean) =>
    fetchApi<{ success: boolean }>(`/api/menus/${id}/inventory`, {
      method: "PATCH",
      body: { inventoryEnabled },
    }),
};

// Topping API
export const toppingApi = {
  list: (circleId: string, includeArchived = false) =>
    fetchApi<Topping[]>(`/api/toppings?circleId=${encodeURIComponent(circleId)}${includeArchived ? "&includeArchived=true" : ""}`),
  get: (id: string) => fetchApi<Topping>(`/api/toppings/${id}`),
  create: (data: CreateToppingInput) =>
    fetchApi<{ id: string }>("/api/toppings", { method: "POST", body: data }),
  update: (id: string, data: UpdateToppingInput) =>
    fetchApi<{ success: boolean }>(`/api/toppings/${id}`, {
      method: "PUT",
      body: data,
    }),
  // 在庫の絶対値更新 (在庫>0 で soldOut は自動解除される)
  updateStock: (id: string, stockQuantity: number) =>
    fetchApi<{ success: boolean }>(`/api/toppings/${id}/stock`, {
      method: "PUT",
      body: { stockQuantity },
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/toppings/${id}`, { method: "DELETE" }),
  restore: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/toppings/${id}/restore`, { method: "POST" }),
};

// Staff API
export const staffApi = {
  list: (circleId: string, includeDeleted = false) =>
    fetchApi<Staff[]>(`/api/staff?circleId=${circleId}${includeDeleted ? "&includeDeleted=true" : ""}`),
  get: (id: string) => fetchApi<Staff>(`/api/staff/${id}`),
  create: (data: CreateStaffInput) =>
    fetchApi<{ id: string }>("/api/staff", { method: "POST", body: data }),
  update: (id: string, data: UpdateStaffInput) =>
    fetchApi<{ success: boolean }>(`/api/staff/${id}`, {
      method: "PUT",
      body: data,
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/staff/${id}`, { method: "DELETE" }),
  restore: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/staff/${id}/restore`, { method: "POST" }),
  // 2026-07-14: シフト機能(getCurrentShift/clockIn/clockOut)を撤去。
};

// Order API
export interface ProjectorOrder {
  orderNumber: string;
  status: string;
  receivedAt: string | null;
  createdAt: string;
}

export interface RegisterDisplaySession {
  id: string;
  token: string;
  revision: number;
  expiresAt: number;
}

export interface RegisterDisplayResponse {
  snapshot: RegisterDisplaySnapshot;
  revision: number;
  updatedAt: number;
  expiresAt: number;
}

export const orderApi = {
  list: (circleId: string, status?: string) =>
    fetchApi<OrderWithItems[]>(
      `/api/orders?circleId=${circleId}${status ? `&status=${status}` : ""}`
    ),
  projector: (circleId: string) =>
    fetchApi<ProjectorOrder[]>(`/api/orders/projector?circleId=${encodeURIComponent(circleId)}`),
  createRegisterDisplay: (circleId: string, snapshot: RegisterDisplaySnapshot) =>
    fetchApi<RegisterDisplaySession>("/api/orders/register-displays", {
      method: "POST",
      body: { circleId, snapshot },
    }),
  updateRegisterDisplay: (id: string, snapshot: RegisterDisplaySnapshot, revision: number) =>
    fetchApi<{ success: boolean }>(`/api/orders/register-displays/${encodeURIComponent(id)}/snapshot`, {
      method: "PUT",
      body: { snapshot, revision },
    }),
  getRegisterDisplay: (id: string, token: string) =>
    fetchApi<RegisterDisplayResponse>(`/api/orders/register-displays/${encodeURIComponent(id)}/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  closeRegisterDisplay: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/orders/register-displays/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  get: (id: string) => fetchApi<OrderWithItems>(`/api/orders/${id}`),
  getUnpaidMobileByUser: (circleId: string, userId: string) =>
    fetchApi<OrderWithItems[]>(`/api/orders/mobile/unpaid?circleId=${encodeURIComponent(circleId)}&userId=${encodeURIComponent(userId)}`),
  settleMobile: (id: string, paymentMethod: string) =>
    fetchApi<{ success: true; alreadyPaid: boolean; paidAt: string }>(`/api/orders/${encodeURIComponent(id)}/settle`, {
      method: "POST",
      body: { paymentMethod },
    }),
  // 来場者本人の注文履歴 (レジを通った注文)。code = eventUser.id or リストバンドID。
  // 旧実装 (getByCode) の .catch(()=>[]) は 500 を空表示に握り潰し障害を隠していたため、
  // ここでは握り潰さず react-query の isError → ErrorState に流して可視化する。
  getByUser: (code: string) =>
    fetchApi<VisitorOrderHistory[]>(
      `/api/orders/user/${encodeURIComponent(code)}`
    ),
  getByOrderNumber: (circleId: string, orderNumber: string) =>
    fetchApi<Order>(
      `/api/orders/by-number/${orderNumber}?circleId=${circleId}`
    ),
  // 2026-10-03: 再試行のキーは画面の会計単位で生成・保持し、レスポンスも共有契約で検証する。
  create: async (data: CreateOrderInput, idempotencyKey: string): Promise<CreateOrderResult> =>
    createOrderResultSchema.parse(await fetchApi<unknown>("/api/orders", {
      method: "POST",
      body: data,
      headers: { "Idempotency-Key": idempotencyKey },
    })),
  // 2026-10-17: 来場者注文をレジ注文とAPI経路から分け、サークル設定をサーバー側で強制する。
  createMobile: async (data: CreateOrderInput, idempotencyKey: string): Promise<CreateOrderResult> =>
    createOrderResultSchema.parse(await fetchApi<unknown>("/api/orders/mobile", {
      method: "POST",
      body: data,
      headers: { "Idempotency-Key": idempotencyKey },
    })),
  updateStatus: (id: string, status: OrderStatus, options?: { refundConfirmed?: boolean }) =>
    fetchApi<{ success: boolean; refund: { amount: number; refundedAt: string } | null }>(`/api/orders/${id}/status`, {
      method: "PATCH",
      body: { status, ...options },
    }),
  complete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/orders/${id}/complete`, {
      method: "POST",
    }),
  markReceived: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/orders/${id}/received`, {
      method: "POST",
    }),
  // 2026-10-21: 来場者用は本人のeventUser IDを送り、サーバーで注文所有者を照合する。
  markReceivedByVisitor: (code: string, id: string) =>
    fetchApi<{ success: boolean }>(`/api/orders/user/${encodeURIComponent(code)}/${encodeURIComponent(id)}/received`, {
      method: "POST",
    }),
  setEstimatedTime: (id: string, estimatedMinutes: number) =>
    fetchApi<{ success: boolean }>(`/api/orders/${id}/estimated-time`, {
      method: "PATCH",
      body: { estimatedMinutes },
    }),
  getSalesStats: (circleId: string, dateFrom?: string, dateTo?: string) => {
    let url = `/api/orders/stats/sales?circleId=${circleId}`;
    if (dateFrom) url += `&dateFrom=${dateFrom}`;
    if (dateTo) url += `&dateTo=${dateTo}`;
    return fetchApi<SalesStats>(url);
  },
};

export interface VisitorReviewTarget {
  circleId: string;
  circleName: string;
  review: { rating: number; comment: string | null } | null;
}

export interface VisitorReviewStoreSummary {
  circleId: string;
  circleName: string;
  showAverageRating: boolean;
  averageRating: number | null;
  reviewCount: number;
  /** 1つ星から5つ星の件数。星の平均を公開している店舗だけ集計する。 */
  ratingDistribution: number[];
}

export interface VisitorPublicReview {
  rating: number | null;
  comment: string | null;
  createdAt: string | number | Date;
}

export interface PublicStoreReviewList {
  reviewCount: number;
  showStars: boolean;
  showComments: boolean;
  reviews: VisitorPublicReview[];
}

export interface ManagedReview {
  circleId?: string;
  circleName?: string;
  rating: number;
  comment: string | null;
  createdAt: string | number | Date;
  displayId: number;
}

// 2026-10-16: 投稿候補は自身の利用履歴に限定し、店舗レビューは匿名表示、管理側一覧は sales:read 権限を維持する。
export const reviewApi = {
  mine: (code: string) => fetchApi<VisitorReviewTarget[]>(`/api/reviews/visitor/${encodeURIComponent(code)}`),
  stores: (code: string) => fetchApi<VisitorReviewStoreSummary[]>(`/api/reviews/visitor/${encodeURIComponent(code)}/stores`),
  storeReviews: (code: string, circleId: string) => fetchApi<VisitorPublicReview[]>(`/api/reviews/visitor/${encodeURIComponent(code)}/stores/${encodeURIComponent(circleId)}`),
  // 2026-10-21: 未登録の来場者も評価を見られるようイベントIDで公開一覧を取得し、API側で店舗設定を適用する。
  publicStores: (eventId: string) => fetchApi<VisitorReviewStoreSummary[]>(`/api/reviews/public/events/${encodeURIComponent(eventId)}/stores`),
  publicStoreReviews: (eventId: string, circleId: string) => fetchApi<PublicStoreReviewList>(`/api/reviews/public/events/${encodeURIComponent(eventId)}/stores/${encodeURIComponent(circleId)}/reviews`),
  submit: (code: string, body: { circleId: string; rating: number; comment: string }) =>
    fetchApi<{ success: boolean }>(`/api/reviews/visitor/${encodeURIComponent(code)}`, { method: "POST", body }),
  circle: (circleId: string) => fetchApi<ManagedReview[]>(`/api/reviews/circle/${encodeURIComponent(circleId)}`),
  event: (eventId: string) => fetchApi<ManagedReview[]>(`/api/reviews/event/${encodeURIComponent(eventId)}`),
};

// Membership API
export const membershipApi = {
  getRoles: () => fetchApi<RoleInfo[]>("/api/memberships/roles"),
  // 2026-10-19: /my はセッションから本人を特定するため、識別子をクエリへ含めない。
  myMemberships: () => fetchApi<MembershipWithRelations[]>("/api/memberships/my"),
  listByCircle: (circleId: string) =>
    fetchApi<MembershipWithUser[]>(`/api/memberships/circle/${circleId}`),
  listByEvent: (eventId: string) =>
    fetchApi<MembershipWithUser[]>(`/api/memberships/event/${eventId}`),
  checkPermission: (data: CheckPermissionInput) =>
    fetchApi<CheckPermissionResult>("/api/memberships/check-permission", {
      method: "POST",
      body: data,
    }),
  addMember: (data: AddMemberInput) =>
    fetchApi<{ id: string }>("/api/memberships", {
      method: "POST",
      body: data,
    }),
  updateRole: (id: string, role: Role) =>
    fetchApi<{ success: boolean }>(`/api/memberships/${id}/role`, {
      method: "PATCH",
      body: { role },
    }),
  deactivate: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/memberships/${id}/deactivate`, {
      method: "PATCH",
    }),
  reactivate: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/memberships/${id}/reactivate`, {
      method: "PATCH",
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/memberships/${id}`, {
      method: "DELETE",
    }),
  createInvite: (data: CreateInviteInput) =>
    fetchApi<{ token: string; code: string; expiresAt: Date }>("/api/memberships/invite", {
      method: "POST",
      body: data,
    }),
  // 招待の照会 (token か code から種別/イベント/サークル/ロールを取得)。2026-07-12
  inviteLookup: (params: { token?: string; code?: string }) => {
    const q = params.token
      ? `token=${encodeURIComponent(params.token)}`
      : `code=${encodeURIComponent(params.code || "")}`;
    return fetchApi<InviteLookupResult>(`/api/memberships/invite/lookup?${q}`);
  },
  acceptInvite: (data: AcceptInviteInput) =>
    fetchApi<{ membershipId?: string; kind: InviteKind; eventId?: string; token?: string }>(
      "/api/memberships/invite/accept",
      { method: "POST", body: data }
    ),
  listInvites: (circleId?: string, eventId?: string) => {
    const params = circleId
      ? `circleId=${circleId}`
      : eventId
      ? `eventId=${eventId}`
      : "";
    return fetchApi<InviteToken[]>(`/api/memberships/invite/list?${params}`);
  },
  // 招待の有効期限を「今から N 時間後」に延長する (2026-07-14 P1-4)。
  extendInvite: (id: string, expiresInHours: number) =>
    fetchApi<{ success: boolean; expiresAt: string }>(`/api/memberships/invite/${id}/extend`, {
      method: "PATCH",
      body: { expiresInHours },
    }),
  // 期限切れの招待を新しい token/code で再発行する (2026-07-14 P1-4 強化)。
  regenerateInvite: (id: string) =>
    fetchApi<{ id: string; token: string; code: string; expiresAt: string }>(
      `/api/memberships/invite/${id}/regenerate`,
      { method: "POST" }
    ),
  deleteInvite: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/memberships/invite/${id}`, {
      method: "DELETE",
    }),
  // 2026-10-19: /my はセッション本人の所属だけを返すため、メールをURLへ重複送信しない。
  listMy: () => fetchApi<any[]>("/api/memberships/my"),
};

// アカウント管理 (2026-07-04 セルフサービス: 名前/アイコン/メール変更・退出・削除)
export interface AccountMe {
  id: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
}
export const accountApi = {
  me: () => fetchApi<AccountMe>("/api/account/me"),
  updateProfile: (data: { name?: string; image?: string | null }) =>
    fetchApi<{ success: boolean }>("/api/account/profile", {
      method: "PATCH",
      body: data,
    }),
  changeEmail: (newEmail: string) =>
    fetchApi<{ success: boolean; email: string }>("/api/account/email", {
      method: "PATCH",
      body: { newEmail },
    }),
  leaveSpace: (membershipId: string) =>
    fetchApi<{ success: boolean }>(`/api/account/membership/${membershipId}`, {
      method: "DELETE",
    }),
  deleteAccount: () =>
    fetchApi<{ success: boolean }>("/api/account", { method: "DELETE" }),
};

// 通知管理 (2026-07-04 SaaS通知対応)
export const notificationApi = {
  list: () => fetchApi<any[]>("/api/memberships/notifications/list"),
  read: (id: string) => fetchApi<{ success: boolean }>(`/api/memberships/notifications/${id}/read`, { method: "POST" }),
  // circle_host 招待の承認時は kind/token/eventId を返す (メンバーシップは作らずサークル作成へ誘導)。
  respond: (id: string, data: { action: "accept" | "decline"; userName?: string }) =>
    fetchApi<{ success: boolean; kind?: string; token?: string; eventId?: string }>(
      `/api/memberships/notifications/${id}/respond`,
      { method: "POST", body: data }
    ),
};

export const pushApi = {
  configuration: () => fetchApi<{ enabled: boolean; publicKey: string | null }>("/api/notifications/config"),
  status: (input: { endpoint: string; visitorId?: string }) =>
    fetchApi<{ subscribed: boolean }>("/api/notifications/subscriptions/status", { method: "POST", body: input }),
  subscribe: (input: { visitorId?: string; subscription: BrowserPushSubscription }) =>
    fetchApi<{ success: boolean }>("/api/notifications/subscriptions", { method: "POST", body: input }),
  unsubscribe: (input: { visitorId?: string; endpoint: string }) =>
    fetchApi<{ success: boolean }>("/api/notifications/subscriptions", { method: "DELETE", body: input }),
};

export interface BrowserPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export interface VisitorNotification {
  id: string;
  eventId: string;
  eventUserId: string;
  type: string;
  title: string;
  message: string;
  href: string;
  readAt: string | null;
  createdAt: string;
}

// 画像アップロード
export const uploadImage = async (
  file: File
): Promise<{ path: string; fileName: string }> => {
  const formData = new FormData();
  formData.append("file", file);

  const baseUrl = getApiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
  } catch (err) {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("fesflow:api-network-failure"));
    throw networkApiError(err);
  }

  if (typeof window !== "undefined") {
    // 2026-10-21: 画像・動画アップロードも通信状態の判定へ含める。
    window.dispatchEvent(new Event(response.status >= 500 ? "fesflow:api-server-failure" : "fesflow:api-network-success"));
  }

  if (!response.ok) {
    // Phase4: /api/upload も統一エラーエンベロープを返すため fetchApi と同じパースを使う。
    throw await apiErrorFromResponse(response);
  }

  return response.json();
};

// Types
export interface EventTheme {
  logoUrl?: string | null;
  officialWebsiteUrl?: string | null;
  fontFamily?: string;
  customFontUrl?: string | null;
  primaryColor?: string;
  primaryTextColor?: string;
  accentColor?: string;
  accentTextColor?: string;
  backgroundColor?: string;
  textColor?: string;
  eventName?: string;
  description?: string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  hasPhysicalWristband?: boolean;
  allowSelfIssue?: boolean;
}



export interface Event extends EventTheme {
  id: string;
  eventName: string;
  description: string | null;
  hasPhysicalWristband: boolean;
  allowSelfIssue: boolean;
  // 利用可能な支払い方法 (JSON 文字列配列)。parseEventPaymentMethods でパースする。
  paymentMethods?: string;
  // 店舗の位置カテゴリはイベント共通のID付きJSON一覧。
  storeAreas?: string;
  // 抽選機能(イベント単位)の有効化フラグ (2026-07-12)。
  lotteryEnabled?: boolean;
  // イベント別スタンプラリー設定 (JSON文字列)。
  stampRallySettings?: string;
  // 高度な権限管理 (2026-10-05)。OFF ではサークル所属の全員が circle_manager 相当。
  advancedPermissions?: boolean;
  // 開催ライフサイクル状態 (2026-07-15): upcoming(開催前) / live(開催中) / ended(終了) / archived(保持)。
  lifecycleStatus?: "upcoming" | "live" | "ended" | "archived";
  startDate: Date | null;
  endDate: Date | null;
}

export interface PublicEventSummary {
  id: string;
  eventName: string;
  description: string | null;
  officialWebsiteUrl: string | null;
  logoUrl: string | null;
}

export interface EventStoreArea {
  id: string;
  name: string;
}

export function parseStoreAreas(raw?: string | null): EventStoreArea[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): EventStoreArea[] => {
      if (!value || typeof value !== "object") return [];
      const area = value as Partial<EventStoreArea>;
      return typeof area.id === "string" && typeof area.name === "string" && area.id.trim() && area.name.trim()
        ? [{ id: area.id.trim(), name: area.name.trim() }]
        : [];
    });
  } catch {
    return [];
  }
}

export interface StampRallyArea {
  id: string;
  name: string;
  requiredCount: number | null;
  circles: StampRallyCircle[];
}

export interface StampRallySettings {
  enabled: boolean;
  targetAreaIds: string[];
  qualification: StampRallyQualificationRule;
  rewardTitle: string;
  rewards?: StampRallyReward[];
  redemptionLocation: string;
  rulesUrl: string;
}

export interface StampRallyQualificationRule {
  minQualifiedAreaCount: number | null;
  minDistinctCirclesPerArea: {
    default: number;
    byArea: Record<string, number>;
  };
  requiredAreaIds: string[];
  minTotalDistinctCircles: number | null;
}

export interface VisitorStampRallyQualification {
  minQualifiedAreaCount: number | null;
  qualifiedAreaCount: number;
  qualifiedAreaIds: string[];
  requiredAreaIds: string[];
  minTotalDistinctCircles: number | null;
}

export interface StampRallyReward {
  id: string;
  name: string;
  stockQuantity: number | null;
}

export interface StampRallyCircle {
  id: string;
  name: string;
  iconImagePath: string | null;
  stamped: boolean;
  orders: StampRallyOrder[];
}

export interface StampRallyOrder {
  orderNumber: string;
  completedAt: string | null;
  createdAt: string;
  items: Array<{
    menuName: string;
    quantity: number;
    toppings: string[];
  }>;
}

export interface VisitorStampRally {
  enabled: boolean;
  eventEnded: boolean;
  stampedCircleIds: string[];
  stampedCount: number;
  targetCircleCount: number;
  qualification: VisitorStampRallyQualification;
  eligible: boolean;
  rewardTitle: string;
  familyMemberCount: number;
  redeemedCount: number;
  remainingCount: number;
  rewards: StampRallyReward[];
  redemptionLocation: string;
  rulesUrl: string;
  redeemedAt: string | null;
  areas: StampRallyArea[];
}

export interface StaffStampRallyLookup {
  visitor: { id: string; eventId: string; displayId: number; nickname: string | null };
  progress: VisitorStampRally;
}

export interface StampRallyRedemption {
  id: string;
  createdAt: string;
  staffId: string;
  eventUserId: string;
  displayId: number;
  nickname: string | null;
  rewardId: string;
  rewardName: string;
  quantity: number;
}

export interface StampRallyRedemptionHistory {
  rewards: StampRallyReward[];
  totalQuantity: number;
  summary: Array<{ rewardId: string; rewardName: string; quantity: number }>;
  history: StampRallyRedemption[];
}

// 2026-10-16: 来場者アカウント・完了注文・匿名注文を分けて返し、物理バンド本数に依存しない実績表示にする。
export interface StampRallyUsageStore {
  circleId: string;
  name: string;
  storeAreaId: string | null;
  storeAreaName: string | null;
  isStampTarget: boolean;
  completedOrderCount: number;
  visitorAccountCount: number;
  unlinkedOrderCount: number;
  orderTotal: number;
  lastUsedAt: string | null;
}

export interface StampRallyUsageSummary {
  enabled: boolean;
  targetAreaIds: string[];
  targetStoreCount: number;
  qualification: StampRallyQualificationRule;
  participantAccountCount: number;
  qualifiedAccountCount: number;
  redeemedAccountCount: number;
  qualifiedRedeemedAccountCount: number;
  redeemedQuantity: number;
  rewards: Array<StampRallyReward & { redeemedQuantity: number; remainingQuantity: number | null }>;
  stores: StampRallyUsageStore[];
}

export interface StampRallyStoreVisitor {
  displayId: number;
  nickname: string | null;
  orderCount: number;
  orderTotal: number;
  lastUsedAt: string | null;
}

export interface StampRallyStoreVisitorsPage {
  store: { id: string; name: string };
  page: number;
  pageSize: number;
  total: number;
  visitors: StampRallyStoreVisitor[];
}

export interface VisitorStampRallyArea extends StampRallyArea {}

export const stampRallyApi = {
  visitor: (code: string) =>
    fetchApi<VisitorStampRally>(`/api/stamps/visitor/${encodeURIComponent(code)}`),
  lookup: (eventId: string, code: string) =>
    fetchApi<StaffStampRallyLookup>(`/api/stamps/event/${encodeURIComponent(eventId)}/lookup/${encodeURIComponent(code)}`),
  redeem: (eventId: string, input: { code: string; rewardId: string; quantity: number }) =>
    fetchApi<{ success: boolean; redemption: { id: string; createdAt: string } }>(`/api/stamps/event/${encodeURIComponent(eventId)}/redeem`, {
      method: "POST",
      body: input,
    }),
  redemptions: (eventId: string) =>
    fetchApi<StampRallyRedemptionHistory>(`/api/stamps/event/${encodeURIComponent(eventId)}/redemptions`),
  usage: (eventId: string) =>
    fetchApi<StampRallyUsageSummary>(`/api/stamps/event/${encodeURIComponent(eventId)}/usage`),
  storeVisitors: (eventId: string, circleId: string, page = 1, query = "") => {
    const params = new URLSearchParams({ page: String(page) });
    if (query.trim()) params.set("q", query.trim());
    return fetchApi<StampRallyStoreVisitorsPage>(
      `/api/stamps/event/${encodeURIComponent(eventId)}/stores/${encodeURIComponent(circleId)}?${params.toString()}`,
    );
  },
};

export type EventLifecycleStatus = "upcoming" | "live" | "ended" | "archived";

// オーナー向け契約状況 (2026-07-16)。運営メモ・入金記録者はサーバ側で除外済み。
export interface EventContract {
  eventId: string;
  eventName: string;
  plan: string;
  billingStatus: BillingStatus;
  billingAmount: number;
  nextBillingAt: string | null;
  maxCircles: number;
  circleCount: number;
  activatedAt: string | null;
  suspendedAt: string | null;
  lifecycleStatus: EventLifecycleStatus;
  paidTotal: number;
  outstanding: number;
  payments: { id: string; amount: number; method: string; paidAt: string; note: string | null }[];
}

// 一斉アナウンス送信履歴 (2026-07-16)。GET /api/festivals/:id/announcements。
export interface EventAnnouncement {
  id: string;
  eventId: string;
  title: string;
  message: string;
  senderEmail: string;
  recipientCount: number;
  deletedAt: string | null;
  createdAt: string;
}

// event.paymentMethods (JSON文字列) を配列にパースする。既定は ["現金"]。
export function parseEventPaymentMethods(raw?: string | null): string[] {
  if (!raw) return ["現金"];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.every((x) => typeof x === "string") && arr.length > 0) return arr;
  } catch {
    /* fall through */
  }
  return ["現金"];
}

// イベント統計 (GET /api/festivals/:id/analytics) のレスポンス
export interface EventAnalytics {
  totals: {
    // 2026-10-19: visitors は入場処理済みの家族アカウント数。事前発行分は別フィールドで返す。
    visitors: number;
    visitorProfiles: number;
    preRegisteredAccounts: number;
    entryRate: number;
    /** @deprecated 2026-10-19: use visitors for the entered family-account count. */
    onboarded: number;
    /** @deprecated 2026-10-19: use entryRate. */
    onboardedRate: number;
    orders: number;
    grossRevenue: number;
    refundOrders: number;
    refundAmount: number;
    revenue: number;
    customers: number;
    avgSpend: number;
    circles: number;
    reviews: number;
    avgRating: number | null;
    completedRate: number;
    circleVisits: number;
    visitingUsers: number;
  };
  byHour: { hour: number; orders: number; revenue: number; refunds: number; visitors: number }[];
  circleRanking: {
    circleId: string;
    name: string;
    revenue: number;
    grossRevenue: number;
    refundAmount: number;
    orders: number;
    reviews: number;
    avgRating: number | null;
  }[];
  menuRanking: { menuName: string; quantity: number; revenue: number }[];
  ageBuckets: { label: string; count: number }[];
  paymentBreakdown: { method: string; orders: number; revenue: number }[];
  refundBreakdown: { method: string; orders: number; amount: number }[];
}

// 来場者行動・混雑・スタッフ分析 (GET /api/festivals/:id/behavior) のレスポンス (2026-07-14)
export interface EventBehavior {
  journey: {
    visitors: number;
    buyers: number;
    buyerRate: number;
    avgOrdersPerBuyer: number;
    avgSpendPerBuyer: number;
    avgCirclesPerVisitor: number;
    repeatBuyerRate: number;
    multiCircleRate: number;
    avgStayMin: number;
    medianStayMin: number;
  };
  stayBuckets: { label: string; count: number }[];
  circleCountBuckets: { label: string; count: number }[];
  byHour: { hour: number; activeUsers: number; orders: number; revenue: number; arrivals: number }[];
  peakHour: number | null;
  funnel: { stage: string; count: number }[];
  staffing: {
    totalStaff: number;
    byCircle: { circleId: string; name: string; staff: number; orders: number; revenue: number; ordersPerStaff: number | null }[];
  };
  topTransitions: { from: string; to: string; count: number }[];
}

// サークル統計 (GET /api/circles/:id/analytics) のレスポンス (2026-07-13)
export interface CircleAnalytics {
  totals: {
    orders: number;
    revenue: number;
    customers: number;
    avgSpend: number;
    completedRate: number;
    avgPrepMin: number | null;
    reviews: number;
    avgRating: number | null;
    visitors: number;
    menus: number;
  };
  byHour: { hour: number; orders: number; revenue: number }[];
  menuRanking: { menuName: string; quantity: number; revenue: number }[];
  paymentBreakdown: { method: string; orders: number; revenue: number }[];
}

// 日次締め (GET /api/festivals/:id/daily-close)
export interface DailyClose {
  date: string;
  totals: {
    orders: number;
    grossRevenue: number;
    refundOrders: number;
    refundAmount: number;
    revenue: number;
    customers: number;
  };
  paymentBreakdown: { method: string; orders: number; revenue: number }[];
  refundBreakdown: { method: string; orders: number; amount: number }[];
  circleBreakdown: {
    circleId: string;
    name: string;
    orders: number;
    grossRevenue: number;
    refundAmount: number;
    refundedOrders: number;
    revenue: number;
  }[];
}

// 進行中注文モニタの1件 (GET /api/festivals/:id/orders/live)
export interface LiveOrder {
  id: string;
  orderNumber: string;
  circleId: string;
  circleName: string;
  status: string;
  peopleCount: number;
  totalPrice: number;
  estimatedTime: number | null;
  createdAt: string;
  items: {
    name: string;
    quantity: number;
    unitPrice: number;
    toppings: { name: string; unitPrice: number }[];
  }[];
}

// 在庫一覧の1件 (GET /api/festivals/:id/inventory)
export interface InventoryItem {
  id: string;
  circleId: string;
  circleName: string;
  name: string;
  price: number;
  soldOut: boolean;
  stockQuantity: number;
  // 在庫管理拡張ON=残数/僅少が意味を持つ。OFF=売切フラグのみ扱う (2026-07-14)
  stockManaged: boolean;
}


export interface Circle {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  iconImagePath: string | null;
  backgroundImagePath: string | null;
  mods?: string;
  settings?: string;
  managerEmail?: string;
  managerName?: string;
}

export interface WaitTimeReport {
  minutes: number;
  reportedAt: string;
}

// 2026-10-07 (#9): 本部と来場者は同じ30分の有効期限で最新報告を表示する。
export function activeWaitTimeReport(raw?: string | null): (WaitTimeReport & { minutesAgo: number }) | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw)?.waitTimeReport as Partial<WaitTimeReport> | undefined;
    if (!parsed || !Number.isInteger(parsed.minutes) || typeof parsed.reportedAt !== "string") return null;
    const ageMs = Date.now() - Date.parse(parsed.reportedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= 30 * 60_000) return null;
    return { minutes: parsed.minutes!, reportedAt: parsed.reportedAt, minutesAgo: Math.floor(ageMs / 60_000) };
  } catch {
    return null;
  }
}

// 2026-10-07 (#9): 報告時系列は既存settings内の履歴を検証して、本部の推移表示に再利用する。
export function recentWaitTimeReports(raw?: string | null, limit = 8): WaitTimeReport[] {
  if (!raw || !Number.isInteger(limit) || limit < 1) return [];
  try {
    const parsed = JSON.parse(raw);
    const reports: unknown = parsed?.waitTimeReports;
    if (!Array.isArray(reports)) return [];
    return reports
      .filter((report): report is WaitTimeReport =>
        !!report &&
        typeof report === "object" &&
        Number.isInteger((report as WaitTimeReport).minutes) &&
        (report as WaitTimeReport).minutes >= 0 &&
        (report as WaitTimeReport).minutes <= 240 &&
        typeof (report as WaitTimeReport).reportedAt === "string" &&
        Number.isFinite(Date.parse((report as WaitTimeReport).reportedAt))
      )
      .sort((a, b) => Date.parse(a.reportedAt) - Date.parse(b.reportedAt))
      .slice(-limit);
  } catch {
    return [];
  }
}

// サークル運用設定 (circle.settings JSON のシェイプ)
export type OrderFlowMode = "pending" | "preparing" | "completed";
// 2026-10-21: レビューは店舗の明示設定を公開境界とし、平均・星・文章を個別に制御する。
export interface CircleReviewPublicationSettings {
  publishReviews: boolean;
  showAverageRating: boolean;
  showStars: boolean;
  showComments: boolean;
}

export interface OrderNumberDisplayMedia {
  id: string;
  name: string;
  kind: "image" | "video";
  durationSeconds: number;
}

export interface OrderNumberDisplaySettings {
  showPreparingNumbers: boolean;
  showPickupNumbers: boolean;
  overflowPriority: "latest" | "oldest";
  // 2026-10-21: 番号表示とローカルメディアに割り当てる画面比率を共有設定へ保存する。
  mediaPercent: number;
  media: OrderNumberDisplayMedia[];
}

export interface CircleSettings {
  // 新規注文の初期状態: pending=未着手 / preparing=調理中 / completed=即完成
  orderFlowMode: OrderFlowMode;
  // 2026-10-21: 事前注文はレジで確定する注文とは別の受け入れ設定にする。
  preOrderEnabled: boolean;
  // 2026-10-17: 来場者の確定注文は店舗が許可した場合だけ受け付ける (初期値は停止)。
  mobileOrderEnabled: boolean;
  // 組み込み拡張機能のON/OFF (既定はすべてOFF=オプトイン)
  extensions: {
    stock: boolean;
    staff: boolean;
  };
  // このサークルが対応する支払い方法 (2026-07-12)。イベントの paymentMethods の部分集合。
  // 空=イベントの全方法に対応とみなす。1つだけならレジで選択させず自動採用する。
  acceptedPayments: string[];
  // 2026-10-16 (#126): event.storeAreas のどの位置に出店するかを参照するID。
  storeAreaId: string | null;
  reviewPublication: CircleReviewPublicationSettings;
  orderNumberDisplay: OrderNumberDisplaySettings;
}

// settings JSON をパースし、未設定キーを既定値で補完する
export function parseCircleSettings(raw?: string | null): CircleSettings {
  const defaults: CircleSettings = {
    orderFlowMode: "pending",
    // 2026-10-21: 設定キーを持たない既存サークルは従来どおり事前注文を受け付ける。
    preOrderEnabled: true,
    mobileOrderEnabled: false,
    extensions: { stock: false, staff: false },
    acceptedPayments: [],
    storeAreaId: null,
    reviewPublication: {
      publishReviews: false,
      showAverageRating: false,
      showStars: false,
      showComments: false,
    },
    orderNumberDisplay: {
      showPreparingNumbers: true,
      showPickupNumbers: true,
      overflowPriority: "latest",
      mediaPercent: 35,
      media: [],
    },
  };
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return {
      orderFlowMode:
        parsed?.orderFlowMode === "preparing" ||
        parsed?.orderFlowMode === "completed"
          ? parsed.orderFlowMode
          : "pending",
      preOrderEnabled: parsed?.preOrderEnabled !== false,
      mobileOrderEnabled: parsed?.mobileOrderEnabled === true,
      extensions: {
        stock: parsed?.extensions?.stock === true,
        staff: parsed?.extensions?.staff === true,
      },
      acceptedPayments: Array.isArray(parsed?.acceptedPayments)
        ? parsed.acceptedPayments.filter((x: unknown) => typeof x === "string")
        : [],
      storeAreaId: typeof parsed?.storeAreaId === "string" ? parsed.storeAreaId : null,
      // 2026-10-21: 既存店舗はレビューを未公開として扱い、明示的な公開設定なしに文章や評価を配信しない。
      reviewPublication: {
        publishReviews: parsed?.reviewPublication?.publishReviews === true,
        showAverageRating: parsed?.reviewPublication?.showAverageRating === true,
        showStars: parsed?.reviewPublication?.showStars === true,
        showComments: parsed?.reviewPublication?.showComments === true,
      },
      // 2026-10-21: 共有設定には端末内メディアの識別子だけを残し、ファイル本体やURLは保存しない。
      orderNumberDisplay: (() => {
        const rawDisplay = parsed?.orderNumberDisplay;
        const media = Array.isArray(rawDisplay?.media)
          ? rawDisplay.media.flatMap((item: unknown) => {
              if (!item || typeof item !== "object") return [];
              const candidate = item as Record<string, unknown>;
              if (
                typeof candidate.id !== "string" ||
                typeof candidate.name !== "string" ||
                (candidate.kind !== "image" && candidate.kind !== "video")
              ) return [];
              return [{
                id: candidate.id.slice(0, 80),
                name: candidate.name.slice(0, 160),
                kind: candidate.kind,
                durationSeconds: typeof candidate.durationSeconds === "number" && Number.isFinite(candidate.durationSeconds)
                  ? Math.max(2, Math.min(60, Math.round(candidate.durationSeconds)))
                  : 8,
              }];
            }).slice(0, 20)
          : [];
        const showPreparingNumbers = rawDisplay?.showPreparingNumbers !== false;
        const showPickupNumbers = rawDisplay?.showPickupNumbers !== false;
        return {
          showPreparingNumbers: showPreparingNumbers || !showPickupNumbers,
          showPickupNumbers,
          overflowPriority: rawDisplay?.overflowPriority === "oldest" ? "oldest" as const : "latest" as const,
          mediaPercent: typeof rawDisplay?.mediaPercent === "number" && Number.isFinite(rawDisplay.mediaPercent)
            ? Math.max(20, Math.min(80, Math.round(rawDisplay.mediaPercent / 5) * 5))
            : 35,
          media,
        };
      })(),
    };
  } catch {
    return defaults;
  }
}

export interface Menu {
  id: string;
  circleId: string;
  name: string;
  category: string;
  price: number;
  description: string | null;
  /** null=未登録、JSON配列の空文字列は明示的な「なし」。 */
  allergens: string | null;
  imagePath: string | null;
  stockQuantity: number | null;
  inventoryEnabled: boolean;
  soldOut: boolean;
  isArchived: boolean;
  /** 既定トッピングID配列を JSON 文字列で保持 (例: '["t1","t2"]') */
  defaultToppingIds?: string;
  toppingWizardEnabled: boolean;
  toppingCategoryMinimums: string;
  toppingCategoryMaximums?: string;
}

export interface Topping {
  id: string;
  circleId: string;
  name: string;
  category: string;
  price: number;
  description: string | null;
  allergens: string | null;
  imagePath: string | null;
  soldOut: boolean;
  stockQuantity: number;
  sortOrder: number;
  isArchived: boolean;
}

export interface MenuWithToppings extends Menu {
  toppings: Topping[];
}

export interface Staff {
  id: string;
  circleId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: string | null;
}

export interface Order {
  id: string;
  circleId: string;
  orderNumber: string;
  status: OrderStatus;
  source: "pos" | "mobile";
  totalPrice: number;
  notes: string | null;
  estimatedMinutes: number | null;
  createdAt: Date | null;
  completedAt: Date | null;
  receivedAt: Date | null;
  peopleCount: number;
  paymentMethod: string | null;
  paymentStatus: "paid" | "unpaid" | "refunded";
  paidAt: Date | null;
  refund?: {
    amount: number;
    originalPaymentMethod: string | null;
    refundedBy: string | null;
    refundedAt: Date;
  } | null;
  // レジ担当者 (order.cashier_id)。スタッフ向け一覧 (orderApi.list) にのみ含まれる想定で、
  // 来場者向け履歴 API (orders/user/:code) は意図的にこの項目を返さない。
  cashierId: string | null;
}

export interface OrderItemTopping {
  id: string;
  orderItemId: string;
  toppingId: string;
  toppingName: string;
  price: number;
}

export interface OrderItem {
  id: string;
  orderId: string;
  menuId: string;
  menuName: string;
  quantity: number;
  menuPrice: number;
  toppings?: OrderItemTopping[];
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

// 来場者の注文履歴 (GET /api/orders/user/:code)。
// レジ内部情報 (cashierId / paymentMethod 等) はサーバ側で除外済みの本人向けビュー。
export interface VisitorOrderHistoryItem {
  id: string;
  menuId: string;
  menuName: string;
  menuPrice: number;
  quantity: number;
  toppings: { id: string; name: string; price: number }[];
}

export interface VisitorOrderHistory {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: "paid" | "unpaid" | "refunded";
  totalPrice: number;
  peopleCount: number;
  circleId: string;
  circleName: string | null;
  createdAt: string;
  completedAt: string | null;
  receivedAt: string | null;
  estimatedTime: number | null;
  items: VisitorOrderHistoryItem[];
}

export interface SalesStats {
  totalSales: number;
  totalOrders: number;
  averageOrderValue: number;
}

// 2026-07-11: バックエンド (apps/api membership の z.enum) が受理する正規ロールは
//   super_admin / event_manager / circle_manager / circle_staff の4種。
// 従来この型は旧ロール体系 (cashier/waiter/viewer 等) のままで実バックエンドと乖離しており、
// 招待/メンバー追加でこれらを送ると 400 になっていた (実装が「間に合っていない」ように見えた原因)。
// まずバックエンド正規ロールを先頭に加えて型と実挙動を一致させる。旧・イベント系ロールは
// 参照箇所 (EventStaffFormModal 等) が残っているため当面は残置し、別途整理する。
// API が受理する正規ロールを共有定義から参照し、未対応ロールを送信可能な型に残さない。
export type Role = RoleType;

export interface RoleInfo {
  role: Role;
  permissions: string[];
}

export interface Membership {
  id: string;
  userEmail: string;
  userName: string;
  circleId: string | null;
  eventId: string | null;
  role: string;
  isActive: boolean;
  invitedAt: Date | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipWithRelations extends Membership {
  circle?: Circle;
  event?: Event;
}

// MembershipWithUser is now the same as Membership since userName/userEmail are included
export type MembershipWithUser = Membership;

export interface InviteToken {
  id: string;
  token: string;
  code: string | null;
  circleId: string | null;
  eventId: string | null;
  role: string;
  expiresAt: Date;
  maxUses: number | null;
  usedCount: number;
  targetEmail?: string | null;
  // 失効フラグ (P1-4 強化)。直近14日以内に失効した招待は一覧に残り、再発行/延長できる。
  expired?: boolean;
  // この招待から作成されたサークル一覧 (使用内訳。P2-5)
  consumedBy?: { id: string; name: string; createdAt: string }[];
}

// Input Types

export interface CreateEventInput {
  eventName: string;
  description?: string;
  officialWebsiteUrl?: string | null;
  logoUrl?: string | null;
  startDate?: string;
  endDate?: string;
  hasPhysicalWristband?: boolean;
  allowSelfIssue?: boolean;
  fontFamily?: "mono" | "sans" | "serif";
  primaryColor?: string;
  primaryTextColor?: string;
  accentColor?: string;
  accentTextColor?: string;
  backgroundColor?: string;
  textColor?: string;
  paymentMethods?: string[];
  storeAreas?: EventStoreArea[];
}

// 2026-07-07 (Phase 3a/3b): サークル作成はセルフサービス化。better-auth ログイン
// ユーザーが eventId/name/description のみを指定して作成し、作成者本人が
// 自動的に circle_manager になる (managerEmail/managerName/managerPin は廃止)。
export interface CreateCircleInput {
  eventId: string;
  name: string;
  description?: string;
  iconImagePath?: string | null;
  backgroundImagePath?: string | null;
  settings?: CircleSettings;
  // 2026-07-12 (SaaS): 非主催者が circle_host 招待でサークルを作る場合に渡す。
  inviteToken?: string;
}

export interface UpdateCircleInput {
  name?: string;
  description?: string;
  // 2026-07-16: サークルアイコン/背景画像の保存に対応。null を渡すと明示的に削除する。
  iconImagePath?: string | null;
  backgroundImagePath?: string | null;
}

export interface CreateMenuInput {
  circleId: string;
  name: string;
  category?: string;
  price: number;
  description?: string;
  allergens: JapaneseAllergen[];
  imagePath?: string;
  imageUrl?: string;
  stockQuantity?: number;
  inventoryEnabled?: boolean;
  stock?: number;
  isAvailable?: boolean;
  soldOut?: boolean;
  toppingIds?: string[];
  defaultToppingIds?: string[];
  toppingWizardEnabled?: boolean;
  toppingCategoryMinimums?: Record<string, number>;
  toppingCategoryMaximums?: Record<string, number>;
}

export interface UpdateMenuInput {
  name?: string;
  category?: string;
  sortOrder?: number;
  price?: number;
  description?: string | null;
  allergens?: JapaneseAllergen[];
  imagePath?: string | null;
  imageUrl?: string;
  stockQuantity?: number | null;
  inventoryEnabled?: boolean;
  stock?: number | null;
  isAvailable?: boolean;
  soldOut?: boolean;
  toppingIds?: string[];
  defaultToppingIds?: string[];
  toppingWizardEnabled?: boolean;
  toppingCategoryMinimums?: Record<string, number>;
  toppingCategoryMaximums?: Record<string, number>;
}

export interface CreateToppingInput {
  circleId: string;
  name: string;
  category?: string;
  price: number;
  description?: string;
  allergens: JapaneseAllergen[];
  imagePath?: string;
  soldOut?: boolean;
  stockQuantity?: number;
  sortOrder?: number;
}

export interface UpdateToppingInput {
  name?: string;
  category?: string;
  price?: number;
  description?: string | null;
  allergens?: JapaneseAllergen[];
  imagePath?: string | null;
  soldOut?: boolean;
  stockQuantity?: number;
  sortOrder?: number;
}

export interface CreateStaffInput {
  circleId: string;
  name: string;
}

export interface UpdateStaffInput {
  name?: string;
}

export interface CheckPermissionInput {
  circleId?: string;
  eventId?: string;
  permission: string;
}

export interface CheckPermissionResult {
  hasPermission: boolean;
  role?: string;
}

export interface AddMemberInput {
  userEmail: string;
  userName: string;
  circleId?: string;
  eventId?: string;
  role: Role;
}

export interface CreateInviteInput {
  circleId?: string;
  eventId?: string;
  role: Role;
  expiresInHours?: number;
  maxUses?: number | null;
  targetEmail?: string;
}

// 2026-07-07 (Phase 3a): 招待受諾は better-auth セッション必須になり、
// userEmail はセッションから解決されるため入力不要 (pin も廃止)。
// 2026-07-12: token(リンク) か code(手入力) のどちらかで受諾できる。
export interface AcceptInviteInput {
  token?: string;
  code?: string;
}

// 招待種別 (2026-07-12 SaaS)
export type InviteKind = "circle_member" | "event_manager" | "circle_host" | "unknown";

export interface InviteLookupResult {
  kind: InviteKind;
  role: Role;
  eventId: string | null;
  circleId: string | null;
  eventName: string | null;
  circleName: string | null;
  token: string;
  valid: boolean;
  reason: string | null;
}

// 来場ユーザー情報 (2026-07-13)
export interface EventUser {
  id: string;
  eventId: string;
  displayId: number;
  status: string;
  nickname?: string | null;
  favoriteDate?: string | null;
  ageGroup?: VisitorAgeGroup | null;
  onboardedAt?: string | null;
  createdAt: string;
}

// Wristband API
export interface WristbandLookupResult {
  user: {
    id: string;
    eventId: string;
    displayId: number;
    status: string;
    nickname?: string | null;
    favoriteDate?: string | null;
    ageGroup?: VisitorAgeGroup | null;
    allergies?: string | null;
    onboardedAt?: string | null;
  };
  wristband: {
    id: string;
    userId: string;
    status: string;
    assignedAt: string;
    nickname?: string | null;
    ageGroup?: VisitorAgeGroup | null;
    onboardedAt?: string | null;
  } | null;
  familyWristbands: Array<{
    id: string;
    userId: string;
    status: string;
    assignedAt: string;
    nickname: string | null;
    ageGroup: VisitorAgeGroup | null;
    onboardedAt: string | null;
  }>;
  familyBandCount: number;
}

export type WristbandStatus = "active" | "lost" | "replaced" | "revoked" | "smartphone";
export type VisitorAccountStatus = "available" | "banned";

export interface VisitorAdminEditorData {
  user: {
    id: string;
    eventId: string;
    displayId: number;
    status: VisitorAccountStatus;
    nickname: string | null;
    favoriteDate: string | null;
    ageGroup: VisitorAgeGroup | null;
    allergies: string | null;
    onboardedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  wristbands: Array<{
    id: string;
    userId: string;
    status: WristbandStatus;
    nickname: string | null;
    ageGroup: VisitorAgeGroup | null;
    onboardedAt: string | null;
    assignedAt: string;
    deactivatedAt: string | null;
  }>;
  circleVisits: Array<{
    id: string;
    circleId: string;
    circleName: string;
    staffId: string | null;
    deletedAt: string | null;
    createdAt: string;
  }>;
  circles: Array<{ id: string; name: string }>;
}

export interface VisitorAdminEditorUpdate {
  profile: {
    displayId: number;
    status: VisitorAccountStatus;
    nickname: string | null;
    favoriteDate: string | null;
    ageGroup: VisitorAgeGroup | null;
    allergies: JapaneseAllergen[] | null;
    onboardedAt: string | null;
  };
  wristbands: Array<{
    id: string;
    isNew?: boolean;
    status: WristbandStatus;
    nickname: string | null;
    ageGroup: VisitorAgeGroup | null;
    onboardedAt: string | null;
    assignedAt: string;
    deactivatedAt: string | null;
  }>;
  circleVisits: Array<{
    id?: string;
    isNew?: boolean;
    isDeleted?: boolean;
    circleId: string;
    staffId: string | null;
    createdAt: string;
  }>;
}

export interface LostWristbandItem {
  user: {
    id: string;
    displayId: number;
    nickname: string | null;
    status: string;
  };
  wristband: {
    id: string;
    userId: string;
    status: "lost";
    nickname: string | null;
    assignedAt: string;
    deactivatedAt: string | null;
  };
}

export type WristbandBatchSource = "generated" | "csv";
export type WristbandBatchStatus = "pending" | "processing" | "completed" | "conflict";
export interface WristbandBatch {
  id: string;
  eventId: string;
  source: WristbandBatchSource;
  prefix: string | null;
  suffixLength: number | null;
  totalCount: number;
  processedCount: number;
  importedCount: number;
  conflictCount: number;
  status: WristbandBatchStatus;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export const wristbandApi = {
  // 2026-07-11: 未知コードで偽ユーザーを捏造する .catch フォールバックを撤去。
  // これがあると本部未発行の任意コードでも擬似セッションが作れてしまい
  // 「本部で発行しなければ登録できない」方針に反する。404 はそのまま失敗させ、
  // 呼び出し側 (Entry の入場エラー / MyPage の ErrorState) で扱う。
  lookup: (code: string) =>
    fetchApi<WristbandLookupResult>(`/api/wristbands/lookup/${encodeURIComponent(code)}`),
  // 2026-10-20: 来場者情報の管理はスキャン用lookupと分離し、イベント単位で権限確認された全関連データを編集する。
  adminEditor: (eventId: string, userId: string) =>
    fetchApi<VisitorAdminEditorData>(
      `/api/wristbands/event/${encodeURIComponent(eventId)}/admin/${encodeURIComponent(userId)}`,
    ),
  updateAdminEditor: (eventId: string, userId: string, data: VisitorAdminEditorUpdate) =>
    fetchApi<{ success: boolean }>(
      `/api/wristbands/event/${encodeURIComponent(eventId)}/admin/${encodeURIComponent(userId)}`,
      { method: "PUT", body: data },
    ),
  search: (
    eventId: string,
    query: string,
    filters: {
      bandType: "all" | "physical" | "smartphone" | "unlinked";
      accountStatus: "all" | "available" | "banned";
      profileStatus: "all" | "complete" | "pending";
    },
    pagination: { offset: number; limit: number },
    sorting: {
      sortBy: "createdAt" | "displayId" | "nickname" | "favoriteDate" | "accountStatus" | "wristbandId" | "bandStatus";
      sortDirection: "asc" | "desc";
    }
  ) =>
    fetchApi<{
      items: WristbandLookupResult[];
      total: number;
      offset: number;
      limit: number;
    }>(
      `/api/wristbands/search?eventId=${encodeURIComponent(eventId)}&query=${encodeURIComponent(query)}` +
        `&bandType=${filters.bandType}&accountStatus=${filters.accountStatus}&profileStatus=${filters.profileStatus}` +
        `&offset=${pagination.offset}&limit=${pagination.limit}` +
        `&sortBy=${sorting.sortBy}&sortDirection=${sorting.sortDirection}`
    ),
  listLost: (eventId: string, query = "", offset = 0, limit = 50) =>
    fetchApi<{ items: LostWristbandItem[]; total: number; offset: number; limit: number }>(
      `/api/wristbands/lost?eventId=${encodeURIComponent(eventId)}&query=${encodeURIComponent(query)}` +
        `&offset=${offset}&limit=${limit}`
    ),
  register: (userId: string, wristbandId: string, replacesWristbandId?: string) =>
    fetchApi<{ success: boolean; wristbandId: string }>("/api/wristbands/register", {
      method: "POST",
      body: { userId, wristbandId, replacesWristbandId },
    }),
  addFamilyMember: (data: {
    userId: string;
    wristbandId: string;
    nickname: string;
    ageGroup: VisitorAgeGroup;
  }) => fetchApi<{ success: boolean; familyBandCount: number }>("/api/wristbands/family-member", {
    method: "POST",
    body: data,
  }),
  updateFamilyMember: (data: {
    userId: string;
    wristbandId: string;
    nickname: string;
    ageGroup: VisitorAgeGroup;
  }) => fetchApi<{ success: boolean }>(`/api/wristbands/family-member/${encodeURIComponent(data.wristbandId)}`, {
    method: "PATCH",
    body: {
      userId: data.userId,
      nickname: data.nickname,
      ageGroup: data.ageGroup,
    },
  }),
  // 既存の未紐付けユーザーにスマホ用デジタルID(sp_)を発行する (2026-07-14)
  issueSmartphone: (userId: string) =>
    fetchApi<{ success: boolean; wristbandId: string }>("/api/wristbands/issue-smartphone", {
      method: "POST",
      body: { userId },
    }),
  reportLost: (wristbandId: string) =>
    fetchApi<{ success: boolean }>(
      `/api/wristbands/${encodeURIComponent(wristbandId)}/report-lost`,
      { method: "POST" }
    ),
  issue: (eventId: string, wristbandId?: string) =>
    fetchApi<{ userId: string; displayId: number; wristbandId: string | null }>("/api/wristbands/issue", {
      method: "POST",
      body: { eventId, wristbandId },
    }),
  importUrls: (eventId: string, urls: string[]) =>
    fetchApi<{ imported: number; firstDisplayId: number }>("/api/wristbands/import", {
      method: "POST",
      body: { eventId, urls },
    }),
  listBatches: (eventId: string, offset = 0, limit = 20) =>
    fetchApi<{ items: WristbandBatch[]; total: number; offset: number; limit: number }>(
      `/api/wristbands/batches?eventId=${encodeURIComponent(eventId)}&offset=${offset}&limit=${limit}`
    ),
  createBatch: (input: {
    eventId: string;
    source: WristbandBatchSource;
    prefix?: string;
    suffixLength?: number;
    urls: string[];
  }) => fetchApi<WristbandBatch>("/api/wristbands/batches", { method: "POST", body: input }),
  processBatch: (batchId: string) =>
    fetchApi<WristbandBatch>(`/api/wristbands/batches/${encodeURIComponent(batchId)}/process`, { method: "POST" }),
  downloadBatchCsv: (batchId: string) =>
    fetchApiBlob(`/api/wristbands/batches/${encodeURIComponent(batchId)}/csv`),
  update: (id: string, data: { status: "active" | "lost" | "replaced" | "revoked" | "smartphone"; userId?: string }) =>
    fetchApi<{ success: boolean }>(`/api/wristbands/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: data,
    }),

};

// 来場者オンボーディング API (2026-07-04)
export interface VisitorProfile {
  id: string;
  eventId: string;
  displayId: number;
  nickname: string | null;
  favoriteDate: string | null;
  ageGroup: VisitorAgeGroup | null;
  allergies?: string | null;
  onboardedAt: string | null;
}

export const visitorApi = {
  onboard: (data: {
    userId: string;
    wristbandId?: string | null;
    nickname: string;
    ageGroup?: VisitorAgeGroup;
  }) =>
    fetchApi<VisitorProfile>("/api/wristbands/onboard", {
      method: "POST",
      body: data,
    }),
  updateAllergies: (userId: string, allergies: JapaneseAllergen[]) =>
    fetchApi<{ success: boolean; allergies: JapaneseAllergen[] }>("/api/wristbands/allergies", {
      method: "POST",
      body: { userId, allergies },
    }),
  notifications: (userId: string) =>
    fetchApi<VisitorNotification[]>(`/api/notifications/visitor/${encodeURIComponent(userId)}`),
  markNotificationRead: (userId: string, notificationId: string) =>
    fetchApi<{ success: boolean }>(`/api/notifications/visitor/${encodeURIComponent(userId)}/${encodeURIComponent(notificationId)}/read`, { method: "POST" }),
};


// PreOrder API
// 事前オーダーアイテムに紐づくトッピング(スナップショット) (2026-07-13)
export interface PreOrderItemTopping {
  id: string;
  name: string;
  price: number;
}

export interface PreOrderItemDetail {
  id: string;
  preOrderId: string;
  menuId: string;
  quantity: number;
  menu?: Menu;
  // getByCode がスナップショットから復元して返す。トッピング未指定なら空配列。
  toppings?: PreOrderItemTopping[];
}

export interface PreOrderWithDetails {
  id: string;
  userId: string;
  circleId: string;
  totalPrice: number;
  status: string;
  createdAt: string;
  // 2026-10-07 Issue #49: updated_atをミリ秒CAS tokenとしてautosaveとclaimで共有する。
  draftVersion?: number;
  // 2026-10-07 Issue #49: 自動保存したカートを開き直したとき、適用済みクーポンを復元する。
  couponSlugs?: string[];
  items: PreOrderItemDetail[];
}

export interface CreatePreOrderInput {
  userId: string;
  circleId: string;
  draftId: string;
  expectedUpdatedAt: number | null;
  items: Array<{
    menuId: string;
    quantity: number;
    // 2026-07-13: 来場者モバイルオーダーのトッピング対応。省略時はトッピング無し。
    toppingIds?: string[];
  }>;
  // クーポン適用 (2026-09-16, issue #50)。/coupon/:slug で検証済みでもサーバ側で再検証する。
  // 複数枚同時適用に対応 (対象が重ならなければ併用できる)。
  coupons?: { slug: string; passphrase: string }[];
}

// クーポン API (issue #50)
// クーポンの種類 (2026-09-16 フィードバック対応)。
// menu_discount: 対象メニューの小計から discountAmount 円引く。
// free_topping: 対象トッピングを freeUnits 個 (null=無制限) まで無料にする。
// cart_percentage: 税・送料を含まない商品小計全体から整数率で割引 (2026-10-16)。
export type CouponKind = "menu_discount" | "free_topping" | "cart_percentage";

export interface Coupon {
  id: string;
  circleId: string;
  title: string;
  slug: string;
  passphrase: string;
  kind: CouponKind;
  discountAmount: number | null; // menu_discount のみ
  discountPercent: number | null; // cart_percentage のみ
  registerOnly: boolean; // true の場合、サークル側POSの会計時だけ適用
  freeUnits: number | null; // free_topping のみ。null = 無制限
  maxRedemptions: number | null; // 使用上限回数。null = 無制限
  redeemedCount: number;
  expiresAt: string | null;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
  menuIds: string[]; // menu_discount の対象
  toppingIds: string[]; // free_topping の対象
}

export type CreateCouponInput =
  | {
      kind: "menu_discount";
      title: string;
      passphrase: string;
      discountAmount: number;
      maxRedemptions?: number; // 未指定 = 使用回数無制限
      expiresAt?: string;
      menuIds: string[];
    }
  | {
      kind: "cart_percentage";
      title: string;
      passphrase?: string;
      discountPercent: number;
      registerOnly?: boolean;
      maxRedemptions?: number;
      expiresAt?: string;
    }
  | {
      kind: "free_topping";
      title: string;
      passphrase: string;
      freeUnits?: number; // 未指定 = 対象トッピングを個数上限なく全部無料にする
      maxRedemptions?: number; // 未指定 = 使用回数無制限
      expiresAt?: string;
      toppingIds: string[];
    };

export interface CouponVerifyResult {
  couponId: string;
  circleId: string;
  title: string;
  kind: CouponKind;
  discountAmount: number | null;
  discountPercent: number | null;
  freeUnits: number | null;
  menuIds: string[];
  toppingIds: string[];
}

export const couponApi = {
  listByCircle: (circleId: string) =>
    fetchApi<Coupon[]>(`/api/coupons/circle/${circleId}`),
  registerOptions: (circleId: string) =>
    fetchApi<{ id: string; title: string; discountPercent: number | null; maxRedemptions: number | null; redeemedCount: number; expiresAt: string | null }[]>(
      `/api/coupons/circle/${circleId}/register-options`,
    ),
  create: (circleId: string, data: CreateCouponInput) =>
    fetchApi<Coupon>(`/api/coupons/circle/${circleId}`, {
      method: "POST",
      body: data,
    }),
  disable: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/coupons/${id}/disable`, {
      method: "POST",
    }),
  // 認証不要 (来場者の合言葉入力ページから直接呼ぶ)。消費はしないプレビュー検証。
  verify: (data: { slug: string; passphrase: string; eventUserId: string }) =>
    fetchApi<CouponVerifyResult>("/api/coupons/verify", {
      method: "POST",
      body: data,
    }),
};

// レジで値引きする設定は配布・合言葉のあるクーポンと分離して扱う。
export type DiscountKind = "percentage" | "amount";
export interface Discount {
  id: string;
  circleId: string;
  title: string;
  kind: DiscountKind;
  value: number;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}
export interface RegisterDiscountOption {
  id: string;
  title: string;
  kind: DiscountKind;
  value: number;
}
import type { BundleKind } from "@fesflow/config/bundle-discount";
// 2026-10-23: 「対象メニューをN個以上」で自動適用する割引 (セット価格/円引き/1個分無料/全体%引き)。注文時にサーバーが自動適用し、画面は同じ規則で合計を先に見せる。
export interface BundleDiscount {
  id: string;
  title: string;
  kind: BundleKind;
  bundleSize: number;
  value: number;
  menuIds: string[];
}
export interface BundleDiscountAdmin extends BundleDiscount {
  circleId: string;
  status: "active" | "disabled";
  createdAt: string;
}
export const bundleDiscountApi = {
  listByCircle: (circleId: string) =>
    fetchApi<BundleDiscountAdmin[]>(`/api/discounts/circle/${encodeURIComponent(circleId)}/bundles`),
  active: (circleId: string) =>
    fetchApi<BundleDiscount[]>(`/api/discounts/circle/${encodeURIComponent(circleId)}/bundles/active`),
  create: (circleId: string, data: { title: string; kind: BundleKind; bundleSize: number; value: number; menuIds: string[] }) =>
    fetchApi<BundleDiscountAdmin>(`/api/discounts/circle/${encodeURIComponent(circleId)}/bundles`, { method: "POST", body: data }),
  disable: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/discounts/bundles/${encodeURIComponent(id)}/disable`, { method: "POST" }),
};

export const discountApi = {
  listByCircle: (circleId: string) =>
    fetchApi<Discount[]>(`/api/discounts/circle/${encodeURIComponent(circleId)}`),
  registerOptions: (circleId: string) =>
    fetchApi<RegisterDiscountOption[]>(`/api/discounts/circle/${encodeURIComponent(circleId)}/register-options`),
  create: (circleId: string, data: { title: string; kind: DiscountKind; value: number }) =>
    fetchApi<Discount>(`/api/discounts/circle/${encodeURIComponent(circleId)}`, { method: "POST", body: data }),
  disable: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/discounts/${encodeURIComponent(id)}/disable`, { method: "POST" }),
};

export const preOrderApi = {
  create: (data: CreatePreOrderInput) =>
    fetchApi<{ success?: boolean; id: string; totalPrice: number; updatedAt: number; deleted?: boolean }>("/api/pre-orders", {
      method: "POST",
      body: data,
    }),
  getByCode: (code: string, circleId?: string) =>
    fetchApi<PreOrderWithDetails[]>(
      `/api/pre-orders/user/${encodeURIComponent(code)}${
        circleId ? `?circleId=${circleId}` : ""
      }`
    ).catch(() => []),
  // 支払い方法 (2026-07-14): レジで選択された方法を受取確定にも渡す (未指定だとDBがNULLになるため)。
  claim: (id: string, cashierId?: string, paymentMethod?: string) =>
    fetchApi<{ success: boolean; orderId: string; orderNumber: string }>(
      `/api/pre-orders/${id}/claim`,
      { method: "POST", body: { cashierId, paymentMethod } }
    ),
};




// ── システム管理 API (2026-07-06) ──────────────────────────────────────
export interface AdminUserAccount {
  email: string;
  name: string;
  isSuperAdmin: boolean;
  memberships: Array<{
    id: string;
    role: string;
    isActive: boolean;
    scope: string;
    scopeName: string;
  }>;
}

export interface SystemLockout {
  id: string;
  key: string;
  scope: string;
  failedCount: number;
  lockedUntil: string | null;
}

export interface SystemSettings {
  maintenance: { enabled: boolean; message: string };
}

export interface AdminSystemSettings extends SystemSettings {
  cleanup: { retentionDays: number; minDays: number; maxDays: number; dryRun: boolean };
}

export type AdminSystemSettingsUpdate = {
  maintenance?: SystemSettings["maintenance"];
  cleanup?: { retentionDays: number };
};

export type AnnouncementLevel = "info" | "warning" | "critical";

export interface PublicAnnouncement {
  id: string;
  title: string;
  body: string;
  level: AnnouncementLevel;
  createdAt: string;
}

export interface AdminAnnouncement extends PublicAnnouncement {
  published: boolean;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AnnouncementInput {
  title: string;
  body?: string;
  level?: AnnouncementLevel;
  published?: boolean;
}

// 公開 (認証不要): メンテナンス + お知らせ
export const systemApi = {
  public: () => fetchApi<SystemSettings>("/api/system/public"),
  announcements: () => fetchApi<PublicAnnouncement[]>("/api/system/announcements"),
};

// super_admin 専用
export const adminApi = {
  listUsers: () => fetchApi<AdminUserAccount[]>("/api/admin/users"),
  updateMembership: (id: string, data: { role?: string; isActive?: boolean }) =>
    fetchApi<{ success: boolean }>(`/api/admin/memberships/${id}`, {
      method: "PATCH",
      body: data,
    }),
  listLockouts: () => fetchApi<SystemLockout[]>("/api/admin/lockouts"),
  clearLockout: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/admin/lockouts/${id}`, { method: "DELETE" }),
  getSettings: () => fetchApi<AdminSystemSettings>("/api/admin/settings"),
  updateSettings: (data: AdminSystemSettingsUpdate) =>
    fetchApi<{ success: boolean }>("/api/admin/settings", { method: "PUT", body: data }),
  // お知らせ CMS
  listAnnouncements: () => fetchApi<AdminAnnouncement[]>("/api/admin/announcements"),
  createAnnouncement: (data: AnnouncementInput) =>
    fetchApi<{ success: boolean; id: string }>("/api/admin/announcements", {
      method: "POST",
      body: data,
    }),
  updateAnnouncement: (id: string, data: Partial<AnnouncementInput>) =>
    fetchApi<{ success: boolean }>(`/api/admin/announcements/${id}`, {
      method: "PATCH",
      body: data,
    }),
  deleteAnnouncement: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/admin/announcements/${id}`, { method: "DELETE" }),
  restoreAnnouncement: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/admin/announcements/${id}/restore`, { method: "POST" }),
  // セッションクリーンアップ (2026-07-12)
  expiredSessionsCount: () => fetchApi<{ count: number }>("/api/admin/sessions/expired-count"),
  cleanupSessions: () => fetchApi<{ success: boolean }>("/api/admin/sessions/cleanup", { method: "POST" }),
  // SaaS 運営: イベント/課金管理 (2026-07-12 Phase C)
  overview: () => fetchApi<AdminOverview>("/api/admin/overview"),
  listEvents: () => fetchApi<AdminEvent[]>("/api/admin/events"),
  updateEvent: (id: string, data: AdminEventPatch) =>
    fetchApi<{ success: boolean }>(`/api/admin/events/${id}`, { method: "PATCH", body: data }),
  deleteEvent: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/admin/events/${id}`, { method: "DELETE" }),
  restoreEvent: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/admin/events/${id}/restore`, { method: "POST" }),
  // 契約入金履歴 (2026-07-15)
  listPayments: (eventId: string) =>
    fetchApi<ContractPayment[]>(`/api/admin/events/${eventId}/payments`),
  addPayment: (eventId: string, data: ContractPaymentInput) =>
    fetchApi<{ id: string }>(`/api/admin/events/${eventId}/payments`, { method: "POST", body: data }),
  deletePayment: (paymentId: string) =>
    fetchApi<{ success: boolean }>(`/api/admin/payments/${paymentId}`, { method: "DELETE" }),
  // sudo (昇格) / impersonation (なりすまし) / 監査 (2026-07-12 Phase D/E)
  sudoStatus: () => fetchApi<{ elevated: boolean; expiresAt: string | null }>("/api/admin/sudo/status"),
  elevate: () => fetchApi<{ elevated: boolean; expiresAt: string }>("/api/admin/sudo/elevate", { method: "POST" }),
  sudoEnd: () => fetchApi<{ success: boolean }>("/api/admin/sudo/end", { method: "POST" }),
  impersonateStatus: () => fetchApi<ImpersonationStatus>("/api/admin/impersonate/status"),
  impersonate: (data: { role: "event_manager" | "circle_manager" | "circle_staff"; eventId?: string; circleId?: string; label?: string }) =>
    fetchApi<ImpersonationStatus>("/api/admin/impersonate", { method: "POST", body: data }),
  impersonateStop: () => fetchApi<{ success: boolean }>("/api/admin/impersonate/stop", { method: "POST" }),
  listAudit: (params: { limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams({ limit: String(params.limit ?? 50), offset: String(params.offset ?? 0) });
    return fetchApi<{ rows: AuditEntry[]; total: number; limit: number; offset: number }>(`/api/admin/audit?${query}`);
  },
};

// 抽選 (2026-07-12)
export interface LotteryEntryConfig {
  base: number;
  perStamp: number;
  perReview: number;
}
export interface LotteryData {
  lottery: {
    id: string;
    eventId: string;
    name: string;
    drawAt: string | null;
    status: string;
    entryConfig: LotteryEntryConfig;
  } | null;
  prizes?: { id: string; name: string; quantity: number }[];
  archivedPrizes?: { id: string; name: string; quantity: number }[];
  entryCount?: number;
  winners?: { id: string; prizeId: string; prizeName: string; eventUserId: string; userLabel: string; claimedAt: string | null }[];
}

export const lotteryApi = {
  get: (eventId: string) => fetchApi<LotteryData>(`/api/lottery?eventId=${eventId}`),
  upsert: (data: { eventId: string; name: string; drawAt?: string; entryConfig?: LotteryEntryConfig }) =>
    fetchApi<{ id: string }>("/api/lottery", { method: "POST", body: data }),
  addPrize: (id: string, data: { name: string; quantity: number }) =>
    fetchApi<{ id: string }>(`/api/lottery/${id}/prizes`, { method: "POST", body: data }),
  deletePrize: (id: string, prizeId: string) =>
    fetchApi<{ success: boolean }>(`/api/lottery/${id}/prizes/${prizeId}`, { method: "DELETE" }),
  restorePrize: (id: string, prizeId: string) =>
    fetchApi<{ success: boolean }>(`/api/lottery/${id}/prizes/${prizeId}/restore`, { method: "POST" }),
  draw: (id: string) => fetchApi<{ drawn: number }>(`/api/lottery/${id}/draw`, { method: "POST" }),
  claim: (id: string, winnerId: string) =>
    fetchApi<{ success: boolean }>(`/api/lottery/${id}/winners/${winnerId}/claim`, { method: "POST" }),
  enter: (id: string, userId: string) =>
    fetchApi<{ entered: boolean }>(`/api/lottery/${id}/enter`, { method: "POST", body: { userId } }),
  result: (id: string, userId: string) =>
    fetchApi<{ status: string; entered: boolean; wins: { prizeName: string; claimedAt: string | null }[] }>(
      `/api/lottery/${id}/result?userId=${userId}`
    ),
};

export interface ImpersonationStatus {
  active: boolean;
  role: string | null;
  eventId: string | null;
  circleId: string | null;
  label: string | null;
  expiresAt: string | null;
}

export interface AuditEntry {
  id: string;
  actorEmail: string;
  action: string;
  asRole: string | null;
  eventId: string | null;
  circleId: string | null;
  method: string | null;
  path: string | null;
  summary: string | null;
  createdAt: string;
}

export interface AdminOverview {
  events: number;
  circles: number;
  accounts: number;
  lockouts: number;
  byPlan: Record<string, number>;
  byStatus: Record<string, number>;
  userGrowth: { date: string; accounts: number; visitors: number }[];
}

export type BillingStatus = "active" | "trial" | "suspended" | "unpaid";

export interface AdminEvent {
  id: string;
  eventName: string;
  deletedAt: string | null;
  ownerEmail: string | null;
  plan: string;
  billingStatus: BillingStatus;
  maxCircles: number;
  circleCount: number;
  createdAt: string;
  activatedAt: string | null;
  suspendedAt: string | null;
  // 契約管理(手動運用)フィールド (2026-07-15)
  billingAmount: number;
  nextBillingAt: string | null;
  contractNotes: string | null;
  paidTotal: number;
  lastPaidAt: string | null;
}

export interface AdminEventPatch {
  eventName?: string;
  plan?: string;
  maxCircles?: number;
  billingStatus?: BillingStatus;
  billingAmount?: number;
  nextBillingAt?: string | null;
  contractNotes?: string | null;
}

// 契約入金記録 (2026-07-15)
export interface ContractPayment {
  id: string;
  eventId: string;
  amount: number;
  method: string;
  paidAt: string;
  note: string | null;
  recordedBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  createdAt: string;
}
export interface ContractPaymentInput {
  amount: number;
  method: string;
  paidAt: string; // ISO
  note?: string;
}
