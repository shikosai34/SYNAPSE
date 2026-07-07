import { apiErrorFromResponse, networkApiError } from "./api-error";

function getApiBaseUrl(): string {
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

  // ローカルストレージのアクティブメンバーシップIDをヘッダーに注入 (2026-07-04 SaaS権限隔離対応)
  const authStored = localStorage.getItem("circleAuth");
  if (authStored) {
    try {
      const authInfo = JSON.parse(authStored);
      if (authInfo.membershipId) {
        headersObj["X-Active-Membership-Id"] = authInfo.membershipId;
      }
    } catch (_) {}
  }

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
    throw networkApiError(err);
  }

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  return await response.json();
}

// Event API
// 2026-07-04: 広告ブロック(Adblocker/Brave Shield)による誤認検知(ERR_BLOCKED_BY_CLIENT)を避けるため、
// エンドポイントを /api/events から /api/festivals に変更。
export const eventApi = {
  list: () => fetchApi<Event[]>("/api/festivals"),
  get: (id: string) => fetchApi<Event>(`/api/festivals/${id}`),
  create: (data: CreateEventInput) =>
    fetchApi<{ id: string }>("/api/festivals", { method: "POST", body: data }),
  updateTheme: (id: string, data: EventTheme) =>
    fetchApi<Event>(`/api/festivals/${id}/theme`, { method: "PUT", body: data }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/festivals/${id}`, { method: "DELETE" }),
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
  transferOwner: (id: string, membershipId: string) =>
    fetchApi<{ success: boolean }>(`/api/circles/${id}/transfer-owner`, {
      method: "POST",
      body: { membershipId },
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/circles/${id}`, { method: "DELETE" }),
};

// Menu API
export const menuApi = {
  list: (circleId: string) =>
    fetchApi<MenuWithToppings[]>(`/api/menus?circleId=${circleId}`),
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
  updateStock: (id: string, stock: number | null) =>
    fetchApi<{ success: boolean }>(`/api/menus/${id}/stock`, {
      method: "PATCH",
      body: { stock },
    }),
};

// Topping API
export const toppingApi = {
  list: (circleId: string) =>
    fetchApi<Topping[]>(`/api/toppings?circleId=${circleId}`),
  get: (id: string) => fetchApi<Topping>(`/api/toppings/${id}`),
  create: (data: CreateToppingInput) =>
    fetchApi<{ id: string }>("/api/toppings", { method: "POST", body: data }),
  update: (id: string, data: UpdateToppingInput) =>
    fetchApi<{ success: boolean }>(`/api/toppings/${id}`, {
      method: "PUT",
      body: data,
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/toppings/${id}`, { method: "DELETE" }),
};

// Staff API
export const staffApi = {
  list: (circleId: string) =>
    fetchApi<Staff[]>(`/api/staff?circleId=${circleId}`),
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
  getCurrentShift: (circleId: string) =>
    fetchApi<Staff[]>(`/api/staff/shift/current?circleId=${circleId}`),
  clockIn: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/staff/${id}/clock-in`, {
      method: "POST",
    }),
  clockOut: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/staff/${id}/clock-out`, {
      method: "POST",
    }),
};

// Order API
export const orderApi = {
  list: (circleId: string, status?: string) =>
    fetchApi<OrderWithItems[]>(
      `/api/orders?circleId=${circleId}${status ? `&status=${status}` : ""}`
    ),
  get: (id: string) => fetchApi<OrderWithItems>(`/api/orders/${id}`),
  getByOrderNumber: (circleId: string, orderNumber: string) =>
    fetchApi<Order>(
      `/api/orders/by-number/${orderNumber}?circleId=${circleId}`
    ),
  create: (data: CreateOrderInput) =>
    fetchApi<{ id: string; orderNumber: string }>("/api/orders", {
      method: "POST",
      body: data,
    }),
  updateStatus: (id: string, status: OrderStatus) =>
    fetchApi<{ success: boolean }>(`/api/orders/${id}/status`, {
      method: "PATCH",
      body: { status },
    }),
  complete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/orders/${id}/complete`, {
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

// Membership API
export const membershipApi = {
  getRoles: () => fetchApi<RoleInfo[]>("/api/memberships/roles"),
  myMemberships: (userId: string) =>
    fetchApi<MembershipWithRelations[]>(`/api/memberships/my?userId=${userId}`),
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
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/memberships/${id}`, {
      method: "DELETE",
    }),
  createInvite: (data: CreateInviteInput) =>
    fetchApi<{ token: string; expiresAt: Date }>("/api/memberships/invite", {
      method: "POST",
      body: data,
    }),
  acceptInvite: (data: AcceptInviteInput) =>
    fetchApi<{ membershipId: string }>("/api/memberships/invite/accept", {
      method: "POST",
      body: data,
    }),
  listInvites: (circleId?: string, eventId?: string) => {
    const params = circleId
      ? `circleId=${circleId}`
      : eventId
      ? `eventId=${eventId}`
      : "";
    return fetchApi<InviteToken[]>(`/api/memberships/invite/list?${params}`);
  },
  deleteInvite: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/memberships/invite/${id}`, {
      method: "DELETE",
    }),
  listMy: (userEmail: string) =>
    fetchApi<any[]>(`/api/memberships/my?userEmail=${encodeURIComponent(userEmail)}`),
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
  respond: (id: string, data: { action: "accept" | "decline"; userName?: string }) =>
    fetchApi<{ success: boolean }>(`/api/memberships/notifications/${id}/respond`, {
      method: "POST",
      body: data,
    }),
};

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
    throw networkApiError(err);
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
}



export interface Event extends EventTheme {
  id: string;
  eventName: string;
  description: string | null;
  startDate: Date | null;
  endDate: Date | null;
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

// サークル運用設定 (circle.settings JSON のシェイプ)
export type OrderFlowMode = "pending" | "preparing" | "completed";
export interface CircleSettings {
  // 新規注文の初期状態: pending=未着手 / preparing=調理中 / completed=即完成
  orderFlowMode: OrderFlowMode;
  // 組み込み拡張機能のON/OFF (既定はすべてOFF=オプトイン)
  extensions: {
    stock: boolean;
    staff: boolean;
  };
}

// settings JSON をパースし、未設定キーを既定値で補完する
export function parseCircleSettings(raw?: string | null): CircleSettings {
  const defaults: CircleSettings = {
    orderFlowMode: "pending",
    extensions: { stock: false, staff: false },
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
      extensions: {
        stock: parsed?.extensions?.stock === true,
        staff: parsed?.extensions?.staff === true,
      },
    };
  } catch {
    return defaults;
  }
}

export interface Menu {
  id: string;
  circleId: string;
  name: string;
  price: number;
  description: string | null;
  imagePath: string | null;
  stockQuantity: number | null;
  soldOut: boolean;
  /** 既定トッピングID配列を JSON 文字列で保持 (例: '["t1","t2"]') */
  defaultToppingIds?: string;
}

export interface Topping {
  id: string;
  circleId: string;
  name: string;
  price: number;
  description: string | null;
  imagePath: string | null;
  soldOut: boolean;
}

export interface MenuWithToppings extends Menu {
  toppings: Topping[];
}

export interface Staff {
  id: string;
  circleId: string;
  name: string;
  shiftStart: Date | null;
  shiftEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type OrderStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

export interface Order {
  id: string;
  circleId: string;
  staffId: string | null;
  orderNumber: string;
  status: OrderStatus;
  totalPrice: number;
  notes: string | null;
  estimatedMinutes: number | null;
  createdAt: Date | null;
  completedAt: Date | null;
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

export interface SalesStats {
  totalSales: number;
  totalOrders: number;
  averageOrderValue: number;
}

export type Role =
  | "event_admin"
  | "event_staff"
  | "circle_manager"
  | "cashier"
  | "kitchen_staff"
  | "waiter"
  | "stock_manager"
  | "viewer";

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
  circleId: string | null;
  eventId: string | null;
  role: string;
  expiresAt: Date;
  maxUses: number | null;
  usedCount: number;
}

// Input Types

export interface CreateEventInput {
  eventName: string;
  description?: string;
  startDate?: string;
  endDate?: string;
}

// 2026-07-07 (Phase 3a/3b): サークル作成はセルフサービス化。better-auth ログイン
// ユーザーが eventId/name/description のみを指定して作成し、作成者本人が
// 自動的に circle_manager になる (managerEmail/managerName/managerPin は廃止)。
export interface CreateCircleInput {
  eventId: string;
  name: string;
  description?: string;
}

export interface UpdateCircleInput {
  name?: string;
  description?: string;
}

export interface CreateMenuInput {
  circleId: string;
  name: string;
  price: number;
  description?: string;
  imagePath?: string;
  imageUrl?: string;
  stockQuantity?: number;
  stock?: number;
  isAvailable?: boolean;
  toppingIds?: string[];
  defaultToppingIds?: string[];
}

export interface UpdateMenuInput {
  name?: string;
  price?: number;
  description?: string;
  imagePath?: string | null;
  imageUrl?: string;
  stockQuantity?: number | null;
  stock?: number | null;
  isAvailable?: boolean;
  toppingIds?: string[];
  defaultToppingIds?: string[];
}

export interface CreateToppingInput {
  circleId: string;
  name: string;
  price: number;
  description?: string;
  imagePath?: string;
  stock?: number;
  isAvailable?: boolean;
}

export interface UpdateToppingInput {
  name?: string;
  price?: number;
  description?: string | null;
  imagePath?: string | null;
  stock?: number | null;
  isAvailable?: boolean;
}

export interface CreateStaffInput {
  circleId: string;
  name: string;
}

export interface UpdateStaffInput {
  name?: string;
}

export interface CreateOrderInput {
  circleId: string;
  userId: string; // 2026-07-04: リストバンド/QR必須化のため追加
  staffId?: string;
  peopleCount?: number;
  items: {
    menuId: string;
    quantity: number;
    toppingIds?: string[];
  }[];
  notes?: string;
}

export interface CheckPermissionInput {
  userId: string;
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
  maxUses?: number;
  createdBy: string;
  targetEmail?: string;
}

// 2026-07-07 (Phase 3a): 招待受諾は better-auth セッション必須になり、
// userEmail はセッションから解決されるため入力不要 (pin も廃止)。
export interface AcceptInviteInput {
  token: string;
  userName: string;
}

// Wristband API
export interface WristbandLookupResult {
  user: {
    id: string;
    eventId: string;
    displayId: number;
    status: string;
    nickname?: string | null;
    birthday?: string | null;
    onboardedAt?: string | null;
  };
  wristband: {
    id: string;
    userId: string;
    status: string;
    assignedAt: string;
  } | null;
}

export const wristbandApi = {
  lookup: (code: string) =>
    fetchApi<WristbandLookupResult>(`/api/wristbands/lookup/${encodeURIComponent(code)}`).catch(() => ({
      user: { id: code, eventId: "evt_default", displayId: 999, status: "available", nickname: null, birthday: null, onboardedAt: null },
      wristband: null,
    })),
  search: (eventId: string, query: string) =>
    fetchApi<WristbandLookupResult[]>(
      `/api/wristbands/search?eventId=${encodeURIComponent(eventId)}&query=${encodeURIComponent(query)}`
    ).catch(() => []),
  register: (userId: string, wristbandId: string) =>
    fetchApi<{ success: boolean; wristbandId: string }>("/api/wristbands/register", {
      method: "POST",
      body: { userId, wristbandId },
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
};

// 来場者オンボーディング API (2026-07-04)
export interface VisitorProfile {
  id: string;
  eventId: string;
  displayId: number;
  nickname: string | null;
  birthday: string | null;
  onboardedAt: string | null;
}

export const visitorApi = {
  onboard: (data: { userId: string; nickname: string; birthday?: string }) =>
    fetchApi<VisitorProfile>("/api/wristbands/onboard", {
      method: "POST",
      body: data,
    }),
};


// PreOrder API
export interface PreOrderItemDetail {
  id: string;
  preOrderId: string;
  menuId: string;
  quantity: number;
  menu?: Menu;
}

export interface PreOrderWithDetails {
  id: string;
  userId: string;
  circleId: string;
  totalPrice: number;
  status: string;
  createdAt: string;
  items: PreOrderItemDetail[];
}

export interface CreatePreOrderInput {
  userId: string;
  circleId: string;
  items: Array<{
    menuId: string;
    quantity: number;
  }>;
}

export const preOrderApi = {
  create: (data: CreatePreOrderInput) =>
    fetchApi<{ success: boolean; id: string; totalPrice: number }>("/api/pre-orders", {
      method: "POST",
      body: data,
    }),
  getByCode: (code: string, circleId?: string) =>
    fetchApi<PreOrderWithDetails[]>(
      `/api/pre-orders/user/${encodeURIComponent(code)}${
        circleId ? `?circleId=${circleId}` : ""
      }`
    ).catch(() => []),
  claim: (id: string, cashierId?: string) =>
    fetchApi<{ success: boolean; orderId: string; orderNumber: string }>(
      `/api/pre-orders/${id}/claim`,
      { method: "POST", body: { cashierId } }
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
  getSettings: () => fetchApi<SystemSettings>("/api/admin/settings"),
  updateSettings: (data: Partial<SystemSettings>) =>
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
};
