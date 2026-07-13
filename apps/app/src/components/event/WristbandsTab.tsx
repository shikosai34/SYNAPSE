import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { wristbandApi } from "@/lib/api";
import { extractIdFromCode } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  RefreshCw,
  Users,
  Camera,
  QrCode,
  Plus,
  Smartphone,
  Loader2,
  IdCard,
  Ban,
  CheckCircle,
  XCircle,
  HelpCircle,
  Copy,
  ChevronRight
} from "lucide-react";
import { toast } from "sonner";
import { QrScannerModal } from "@/components/pos/qr-scanner-modal";
import { Modal } from "@/components/ui/Modal";
import { QRCodeSVG } from "qrcode.react";

interface WristbandsTabProps {
  eventId: string;
}

export function WristbandsTab({ eventId }: WristbandsTabProps) {
  const queryClient = useQueryClient();

  // 検索・表示関連の状態
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // モーダル開閉状態
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<"search" | "reissue" | "lookup">("lookup");

  // スキャン・照会モーダル用の手入力コード
  const [lookupCode, setLookupCode] = useState("");

  // 詳細編集モーダル用の状態
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [editNickname, setEditNickname] = useState("");
  const [editFavoriteDate, setEditFavoriteDate] = useState("");
  const [editDisplayId, setEditDisplayId] = useState<number | "">("");
  const [editUserStatus, setEditUserStatus] = useState("available");
  const [reissueWristbandId, setReissueWristbandId] = useState("");

  // 新規スマホ用来場者発行モーダル用の状態
  const [issuedUser, setIssuedUser] = useState<{ userId: string; displayId: number } | null>(null);

  // 来場者一覧・検索クエリ (React Query を使って自動フェッチ&キャッシュ)
  const { data: visitors = [], isLoading, refetch } = useQuery({
    queryKey: ["eventVisitors", eventId, searchQuery],
    queryFn: () => wristbandApi.search(eventId, searchQuery),
  });

  // 詳細編集モーダルのデータ同期
  useEffect(() => {
    if (selectedUser?.user) {
      setEditNickname(selectedUser.user.nickname || "");
      setEditFavoriteDate(selectedUser.user.favoriteDate || "");
      setEditDisplayId(selectedUser.user.displayId || "");
      setEditUserStatus(selectedUser.user.status || "available");
    } else {
      setEditNickname("");
      setEditFavoriteDate("");
      setEditDisplayId("");
      setEditUserStatus("available");
    }
    setReissueWristbandId("");
  }, [selectedUser]);

  // リストバンド照会 API
  const lookupMutation = useMutation({
    mutationFn: (code: string) => {
      const parsedCode = extractIdFromCode(code);
      return wristbandApi.lookup(parsedCode);
    },
    onSuccess: (data) => {
      setSelectedUser(data);
      if (!data.wristband) {
        toast.info("指定のコードに紐づく有効なリストバンドはありませんが、ユーザー情報は取得されました。");
      } else {
        toast.success("ユーザー情報を取得しました");
      }
      setIsDetailsModalOpen(true);
      setIsScanModalOpen(false); // 照会モーダルは閉じる
    },
    onError: () => {
      toast.error("照会に失敗しました。正しいコードを入力してください。");
    },
  });

  // プロフィール更新 API
  const updateProfileMutation = useMutation({
    mutationFn: (input: { userId: string; nickname: string | null; favoriteDate: string | null; displayId: number; status: string }) =>
      wristbandApi.updateUser(input.userId, {
        nickname: input.nickname,
        favoriteDate: input.favoriteDate,
        displayId: input.displayId,
        status: input.status,
      }),
    onSuccess: (_, variables) => {
      toast.success("ユーザー情報を更新しました");
      // キャッシュ更新
      queryClient.invalidateQueries({ queryKey: ["eventVisitors"] });
      // 詳細データを再照会
      lookupMutation.mutate(variables.userId);
    },
    onError: (err: any) => {
      toast.error(err.message || "プロフィールの更新に失敗しました");
    },
  });

  // リストバンド状態更新 API
  const updateWristbandMutation = useMutation({
    mutationFn: (input: { id: string; status: any; userId?: string }) =>
      wristbandApi.update(input.id, { status: input.status, userId: input.userId }),
    onSuccess: () => {
      toast.success("リストバンド情報を更新しました");
      queryClient.invalidateQueries({ queryKey: ["eventVisitors"] });
      if (selectedUser?.user?.id) {
        lookupMutation.mutate(selectedUser.user.id);
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "リストバンド状態の更新に失敗しました");
    },
  });

  // 物理リストバンド新規紐付け・再発行 API
  const registerWristbandMutation = useMutation({
    mutationFn: (input: { userId: string; wristbandId: string }) =>
      wristbandApi.register(input.userId, input.wristbandId),
    onSuccess: () => {
      toast.success("新しいリストバンドをアカウントに紐付けました");
      setReissueWristbandId("");
      queryClient.invalidateQueries({ queryKey: ["eventVisitors"] });
      if (selectedUser?.user?.id) {
        lookupMutation.mutate(selectedUser.user.id);
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "紐付けに失敗しました");
    },
  });

  // スマホ用デジタルQR新規発行 API
  const issueUserMutation = useMutation({
    mutationFn: () => wristbandApi.issue(eventId),
    onSuccess: (data) => {
      setIssuedUser({ userId: data.userId, displayId: data.displayId });
      toast.success("新規来場者アカウントを発行しました");
      queryClient.invalidateQueries({ queryKey: ["eventVisitors"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "発行に失敗しました");
    },
  });

  // 紛失ロックの簡易実行
  const handleReportLost = (wbId: string) => {
    if (!window.confirm("このリストバンドを紛失としてロックしますか？")) return;
    updateWristbandMutation.mutate({ id: wbId, status: "lost" });
  };

  const handleUnlinkWristband = (wbId: string) => {
    if (!window.confirm("このリストバンドの紐付けを解除しますか？")) return;
    updateWristbandMutation.mutate({ id: wbId, status: "revoked", userId: "" });
  };

  const handleScannerScan = (userId: string, wristbandId: string | null) => {
    const code = wristbandId || userId;
    if (scannerTarget === "lookup") {
      setLookupCode(code);
      lookupMutation.mutate(code);
    } else if (scannerTarget === "reissue") {
      setReissueWristbandId(code);
    } else if (scannerTarget === "search") {
      setSearchInput(code);
      setSearchQuery(code);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput.trim());
  };

  const handleResetSearch = () => {
    setSearchInput("");
    setSearchQuery("");
  };

  const getVisitorLink = (userId: string) => {
    const visitorBase = import.meta.env.VITE_VISITOR_URL || window.location.origin.replace("3000", "3001");
    return `${visitorBase}/w/${userId}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("クリップボードにコピーしました");
  };

  return (
    <div className="space-y-6 font-mono text-foreground">
      {/* 画面ヘッダー部 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b-thick border-border pb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <IdCard className="h-4 w-4" />
            来場者・リストバンド管理
          </h2>
          <p className="text-[10px] text-muted-foreground mt-1">
            来場者アカウント情報の変更、紛失リストバンドのロック・再発行、スマホデジタルIDの発行などを一括管理します。
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            onClick={() => {
              setLookupCode("");
              setIsScanModalOpen(true);
            }}
            variant="outline"
            className="border-thick border-border h-9 text-xs font-bold rounded-none shadow-none px-3"
          >
            <Camera className="h-4 w-4 mr-1.5" />
            コード照会 / QRスキャン
          </Button>
          <Button
            onClick={() => {
              setIssuedUser(null);
              setIsIssueModalOpen(true);
            }}
            className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-9 text-xs font-bold rounded-none shadow-none px-3"
          >
            <Plus className="h-4 w-4 mr-1" />
            スマホ年来場者発行
          </Button>
        </div>
      </div>

      {/* 検索バー */}
      <Card className="rounded-none bg-background shadow-none border-thick border-border">
        <CardContent className="p-4">
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ニックネーム、呼出ID（数字のみ）、またはお好きな日付（YYYY-MM-DD）で検索..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9 border-thick border-border rounded-none focus-visible:ring-0 h-10 text-xs bg-background font-mono w-full"
              />
            </div>
            <Button
              type="submit"
              disabled={isLoading}
              className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-10 text-xs font-bold rounded-none shadow-none px-5"
            >
              検索
            </Button>
            {(searchQuery || searchInput) && (
              <Button
                type="button"
                onClick={handleResetSearch}
                variant="outline"
                className="border-thick border-border h-10 text-xs font-bold rounded-none shadow-none px-3"
              >
                クリア
              </Button>
            )}
            <Button
              type="button"
              onClick={() => refetch()}
              variant="outline"
              disabled={isLoading}
              className="border-thick border-border h-10 px-3 rounded-none"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 来場者一覧テーブル */}
      <Card className="rounded-none bg-background shadow-none border-thick border-border">
        <CardHeader className="p-4 pb-2 border-b-thin border-border bg-muted/20 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xs uppercase font-bold">[登録来場者一覧]</CardTitle>
            <CardDescription className="text-[10px]">
              {searchQuery ? `検索条件「${searchQuery}」の検索結果` : "最近登録された来場者（最大50件）"}
            </CardDescription>
          </div>
          <Badge variant="default" className="border-thick border-border font-bold text-[10px] rounded-none">
            {visitors.length} 件
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="p-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                データを読み込み中...
              </div>
            ) : visitors.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                該当する来場者が見つかりません。
              </div>
            ) : (
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b-thin border-border bg-muted/10 font-bold font-mono">
                    <th className="p-3">呼出ID</th>
                    <th className="p-3">ニックネーム</th>
                    <th className="p-3">お好きな日付</th>
                    <th className="p-3">アカウント状態</th>
                    <th className="p-3">紐付くバンドID</th>
                    <th className="p-3">バンド状態</th>
                    <th className="p-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visitors.map((res: any) => (
                    <tr key={res.user.id} className="border-b-thin border-border hover:bg-muted/5 font-mono">
                      <td className="p-3 font-bold">#{res.user.displayId}</td>
                      <td className="p-3">{res.user.nickname || <span className="text-muted-foreground text-[10px]">未登録</span>}</td>
                      <td className="p-3">{res.user.favoriteDate || <span className="text-muted-foreground text-[10px]">未登録</span>}</td>
                      <td className="p-3">
                        <Badge
                          variant="default"
                          className={`rounded-none text-[8px] font-mono border-thick uppercase ${
                            res.user.status === "available"
                              ? "bg-success/10 text-success border-success"
                              : "bg-error/10 text-error border-error"
                          }`}
                        >
                          {res.user.status === "available" ? "利用可能" : "BAN"}
                        </Badge>
                      </td>
                      <td className="p-3 font-mono text-[11px] select-all">{res.wristband?.id || <span className="text-muted-foreground text-[10px]">なし</span>}</td>
                      <td className="p-3">
                        {res.wristband ? (
                          <Badge
                            variant="default"
                            className={`rounded-none text-[8px] font-mono border-thick border-border uppercase ${
                              res.wristband.status === "active"
                                ? "bg-success/10 text-success border-success"
                                : res.wristband.status === "smartphone"
                                ? "bg-info/10 text-info border-info"
                                : "bg-error/10 text-error border-error"
                            }`}
                          >
                            {res.wristband.status === "active"
                              ? "有効"
                              : res.wristband.status === "smartphone"
                              ? "スマホ用"
                              : res.wristband.status === "lost"
                              ? "紛失"
                              : res.wristband.status === "replaced"
                              ? "再発行済"
                              : "無効"}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">未紐付け</span>
                        )}
                      </td>
                      <td className="p-3 text-right flex justify-end gap-1.5">
                        {res.wristband && (res.wristband.status === "active" || res.wristband.status === "smartphone") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleReportLost(res.wristband.id)}
                            className="h-7 text-[10px] rounded-none border-thick border-border bg-background hover:bg-destructive hover:text-white"
                          >
                            ロック
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedUser(res);
                            setIsDetailsModalOpen(true);
                          }}
                          className="h-7 text-[10px] rounded-none border-thick border-border bg-background hover:bg-primary hover:text-primary-foreground"
                        >
                          詳細・編集
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* セルフ登録用QRの出力エリア */}
      <Card className="rounded-none bg-background shadow-none border-thick border-border">
        <CardHeader className="p-4 pb-2 border-b-thin border-border bg-muted/20">
          <CardTitle className="text-xs uppercase font-bold flex items-center gap-1.5">
            <QrCode className="h-4 w-4" />
            [来場者向け・マイデジタルQR発行QRコード]
          </CardTitle>
          <CardDescription className="text-[10px]">来場者が自身のスマートフォンでスキャンし、マイデジタルQRをセルフ発行するための受付用QRです。</CardDescription>
        </CardHeader>
        <CardContent className="p-6 flex flex-col md:flex-row items-center gap-6">
          <div className="border-thick border-border p-3 bg-white shrink-0">
            <QRCodeSVG
              value={getVisitorLink("issue-self-onboard")}
              size={150}
              level="M"
            />
          </div>
          <div className="space-y-2 text-xs font-mono">
            <p className="font-bold underline text-primary">セルフ登録用URL (デジタル受付):</p>
            <p className="bg-muted p-2 select-all break-all border border-border">
              {`${window.location.origin}/visitor/mypage?eventId=${eventId}&action=issue`}
            </p>
            <div className="text-[10px] text-muted-foreground leading-normal space-y-1 pt-2 font-sans">
              <p>1. 受付にこのQRコードを掲示するか、URLを来場者に共有してください。</p>
              <p>2. 来場者がスキャンすると、自動的に「スマホデジタルID（リストバンド代替）」が新規発行され、マイページで支払いやスタンプラリーが使えるようになります。</p>
              <p>※ 物理リストバンドを使わない「スマホ単体イベント」では、このQRだけで受付を完全セルフ化できます。</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ==========================================
          1. 照会・スキャンモーダル
         ========================================== */}
      <Modal
        isOpen={isScanModalOpen}
        title="[登録情報スキャン・照会]"
        subtitle="リストバンド物理ID（QRコード値）またはユーザーIDから、該当の来場者を照会します。"
        onClose={() => setIsScanModalOpen(false)}
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-[10px] uppercase font-bold text-muted-foreground">ID または QRコード値</label>
            <div className="flex gap-2">
              <Input
                placeholder="例: wb_test_xxx または usr_xxxx"
                value={lookupCode}
                onChange={(e) => setLookupCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (lookupCode.trim()) lookupMutation.mutate(lookupCode.trim());
                  }
                }}
                className="border-thick border-border rounded-none focus-visible:ring-0 h-10 text-xs bg-background font-mono flex-1"
              />
              <Button
                onClick={() => {
                  setScannerTarget("lookup");
                  setIsScannerOpen(true);
                }}
                variant="outline"
                className="border-thick border-border h-10 px-3 rounded-none"
              >
                <Camera className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setIsScanModalOpen(false)}
              className="border-thick border-border h-10 text-xs font-bold rounded-none shadow-none px-4"
            >
              キャンセル
            </Button>
            <Button
              onClick={() => lookupMutation.mutate(lookupCode.trim())}
              disabled={!lookupCode.trim() || lookupMutation.isPending}
              className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-10 text-xs font-bold rounded-none shadow-none px-4 flex items-center gap-1"
            >
              {lookupMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              照会する
            </Button>
          </div>
        </div>
      </Modal>

      {/* ==========================================
          2. スマホ用来場者発行モーダル (IssueTabの統合)
         ========================================== */}
      <Modal
        isOpen={isIssueModalOpen}
        title="[スマホ用来場者QR発行]"
        subtitle="物理リストバンドを使用しない、スマートフォン単体用の新規アカウントを即時発行します。"
        onClose={() => setIsIssueModalOpen(false)}
        maxWidth="md"
      >
        <div className="space-y-4">
          {!issuedUser ? (
            <div className="text-center py-6 space-y-4 bg-muted/10 border border-dashed border-border p-4">
              <p className="text-[10px] text-muted-foreground leading-normal max-w-xs mx-auto">
                「アカウントを発行する」ボタンを押すと、このイベント用のチェックインQRコードがその場で生成されます。
              </p>
              <Button
                onClick={() => issueUserMutation.mutate()}
                disabled={issueUserMutation.isPending}
                className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-11 text-xs font-black uppercase rounded-none shadow-none px-6 flex items-center gap-1.5 mx-auto"
              >
                {issueUserMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Smartphone className="h-4 w-4" />
                )}
                アカウントを発行する
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-background p-4 border-thick border-border max-w-[200px] mx-auto text-center bg-white">
                <QRCodeSVG
                  value={getVisitorLink(issuedUser.userId)}
                  size={150}
                  level="M"
                />
              </div>
              <div className="space-y-2 text-xs">
                <div className="bg-muted p-2 border border-border space-y-1 font-mono text-[10px]">
                  <p><strong>呼出ID:</strong> #{issuedUser.displayId}</p>
                  <p><strong>ユーザーID:</strong> {issuedUser.userId}</p>
                  <p className="break-all"><strong>チェックインURL:</strong> {getVisitorLink(issuedUser.userId)}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => copyToClipboard(getVisitorLink(issuedUser.userId))}
                    variant="outline"
                    className="flex-1 border-thick border-border h-9 text-[10px] font-bold rounded-none"
                  >
                    <Copy className="h-3 w-3 mr-1" /> URLをコピー
                  </Button>
                  <Button
                    onClick={() => {
                      // 発行したユーザーの詳細編集を開く
                      lookupMutation.mutate(issuedUser.userId);
                      setIsIssueModalOpen(false);
                    }}
                    className="flex-1 border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-9 text-[10px] font-bold rounded-none"
                  >
                    詳細編集を開く <ChevronRight className="h-3 w-3 ml-0.5" />
                  </Button>
                </div>
                <p className="text-[9px] text-muted-foreground text-center pt-2">
                  ※来場者が自身のスマートフォンでこのQRコードを読み取ると、マイページが起動しオンボードが始まります。
                </p>
              </div>
            </div>
          )}
          <div className="flex justify-end pt-2 border-t border-border">
            <Button
              variant="outline"
              onClick={() => setIsIssueModalOpen(false)}
              className="border-thick border-border h-9 text-xs font-bold rounded-none shadow-none px-4"
            >
              閉じる
            </Button>
          </div>
        </div>
      </Modal>

      {/* ==========================================
          3. 来場者・リストバンド詳細編集モーダル
         ========================================== */}
      <Modal
        isOpen={isDetailsModalOpen}
        title="[来場者・リストバンド詳細編集]"
        subtitle="来場者の基本プロフィール情報、および紐付く物理リストバンドの状態変更・再発行・紐付け解除を行います。"
        onClose={() => {
          setIsDetailsModalOpen(false);
          setSelectedUser(null);
        }}
        maxWidth="xl"
      >
        {selectedUser && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 左カラム: アカウントプロフィール情報 */}
              <div className="space-y-4 border-b md:border-b-0 md:border-r border-border pb-6 md:pb-0 md:pr-6">
                <h3 className="font-black text-xs uppercase tracking-wider text-primary border-b border-border pb-1">
                  [アカウントプロフィール編集]
                </h3>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">ユーザーID (システムID)</label>
                    <div className="flex gap-1.5">
                      <Input
                        value={selectedUser.user.id}
                        disabled
                        className="bg-muted border-thick border-border rounded-none h-8 text-xs font-mono select-all flex-1"
                      />
                      <Button
                        onClick={() => copyToClipboard(selectedUser.user.id)}
                        variant="outline"
                        size="sm"
                        className="border-thick border-border h-8 px-2 rounded-none"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">表示用呼出ID (※重複不可)</label>
                    <Input
                      type="number"
                      value={editDisplayId}
                      onChange={(e) => setEditDisplayId(e.target.value === "" ? "" : Number(e.target.value))}
                      className="border-thick border-border rounded-none h-8 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">ニックネーム</label>
                    <Input
                      value={editNickname}
                      onChange={(e) => setEditNickname(e.target.value)}
                      placeholder="ニックネーム未入力"
                      className="border-thick border-border rounded-none h-8 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">お好きな日付 (YYYY-MM-DD)</label>
                    <Input
                      value={editFavoriteDate}
                      onChange={(e) => setEditFavoriteDate(e.target.value)}
                      placeholder="例: 2000-01-01"
                      className="border-thick border-border rounded-none h-8 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">アカウント制限状態</label>
                    <select
                      value={editUserStatus}
                      onChange={(e) => setEditUserStatus(e.target.value)}
                      className="w-full border-thick border-border bg-background p-1.5 text-xs font-bold font-mono rounded-none"
                    >
                      <option value="available">利用可能 (Available)</option>
                      <option value="banned">アクセス禁止 (Banned)</option>
                    </select>
                  </div>
                </div>

                <Button
                  onClick={() => {
                    if (editDisplayId === "") {
                      toast.error("呼出IDを入力してください");
                      return;
                    }
                    updateProfileMutation.mutate({
                      userId: selectedUser.user.id,
                      nickname: editNickname.trim() || null,
                      favoriteDate: editFavoriteDate.trim() || null,
                      displayId: Number(editDisplayId),
                      status: editUserStatus,
                    });
                  }}
                  disabled={updateProfileMutation.isPending}
                  className="w-full border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-9 text-xs font-bold rounded-none shadow-none mt-4 flex items-center justify-center gap-1"
                >
                  {updateProfileMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  プロフィール情報を保存
                </Button>
              </div>

              {/* 右カラム: リストバンド管理 */}
              <div className="space-y-4">
                <h3 className="font-black text-xs uppercase tracking-wider text-primary border-b border-border pb-1">
                  [紐付く物理リストバンド管理]
                </h3>

                {selectedUser.wristband ? (
                  <div className="space-y-4 text-xs">
                    <div className="bg-muted/20 p-3 border border-border space-y-2 font-mono">
                      <p className="flex justify-between items-center">
                        <span>バンドID: <span className="font-bold select-all">{selectedUser.wristband.id}</span></span>
                        <Button
                          onClick={() => copyToClipboard(selectedUser.wristband.id)}
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </p>
                      <p className="flex items-center gap-2">
                        ステータス:
                        <Badge
                          variant="default"
                          className={`rounded-none text-[8px] font-mono border-thick border-border uppercase ${
                            selectedUser.wristband.status === "active"
                              ? "bg-success/10 text-success border-success"
                              : selectedUser.wristband.status === "smartphone"
                              ? "bg-info/10 text-info border-info"
                              : "bg-error/10 text-error border-error"
                          }`}
                        >
                          {selectedUser.wristband.status === "active"
                            ? "有効 (Active)"
                            : selectedUser.wristband.status === "smartphone"
                            ? "スマホ専用 (Smartphone)"
                            : selectedUser.wristband.status === "lost"
                            ? "紛失 (Lost)"
                            : selectedUser.wristband.status === "replaced"
                            ? "再発行済 (Replaced)"
                            : "無効化 (Revoked)"}
                        </Badge>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        割当日時: {new Date(selectedUser.wristband.assignedAt).toLocaleString("ja-JP")}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 border-t border-border pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[10px] uppercase text-muted-foreground">ステータス手動変更:</span>
                        <select
                          value={selectedUser.wristband.status}
                          onChange={(e) => updateWristbandMutation.mutate({ id: selectedUser.wristband.id, status: e.target.value })}
                          disabled={updateWristbandMutation.isPending}
                          className="border-thick border-border bg-background p-1.5 text-xs font-bold font-mono rounded-none"
                        >
                          <option value="active">有効 (Active)</option>
                          <option value="smartphone">スマホ用 (Smartphone)</option>
                          <option value="lost">紛失 (Lost / ロック)</option>
                          <option value="replaced">再発行済 (Replaced)</option>
                          <option value="revoked">無効化 (Revoked)</option>
                        </select>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUnlinkWristband(selectedUser.wristband.id)}
                        disabled={updateWristbandMutation.isPending}
                        className="w-full rounded-none text-[10px] font-bold h-8 uppercase shadow-none border-thick border-border hover:bg-destructive hover:text-white mt-1"
                      >
                        紐付け解除 (Unlink)
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-muted/10 p-4 text-center border border-dashed border-border text-muted-foreground text-xs font-mono">
                    現在、有効なリストバンドは紐付いていません
                  </div>
                )}

                {/* 新しいリストバンドの登録・再発行 */}
                <div className="border-t border-border pt-4 mt-2 space-y-2">
                  <h4 className="font-bold uppercase text-[10px] text-muted-foreground">
                    [物理リストバンドの新規紐付け・再発行]
                  </h4>
                  <p className="text-[10px] text-muted-foreground leading-normal font-sans">
                    新しいリストバンドのQR/コード値を入力して登録します。（古いリストバンドは自動的に無効化されロックされます）
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="新規リストバンドIDを入力"
                      value={reissueWristbandId}
                      onChange={(e) => setReissueWristbandId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (reissueWristbandId.trim()) {
                            const parsed = extractIdFromCode(reissueWristbandId);
                            registerWristbandMutation.mutate({ userId: selectedUser.user.id, wristbandId: parsed });
                          }
                        }
                      }}
                      className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background font-mono flex-1"
                    />
                    <Button
                      onClick={() => {
                        setScannerTarget("reissue");
                        setIsScannerOpen(true);
                      }}
                      variant="outline"
                      className="border-thick border-border h-9 px-3 rounded-none"
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                    <Button
                      onClick={() => {
                        const parsed = extractIdFromCode(reissueWristbandId);
                        registerWristbandMutation.mutate({ userId: selectedUser.user.id, wristbandId: parsed });
                      }}
                      disabled={!reissueWristbandId.trim() || registerWristbandMutation.isPending}
                      className="border-thick border-border bg-background text-foreground hover:bg-primary hover:text-primary-foreground h-9 text-xs font-bold rounded-none shadow-none px-3"
                    >
                      登録
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end pt-4 border-t border-border">
              <Button
                onClick={() => {
                  setIsDetailsModalOpen(false);
                  setSelectedUser(null);
                }}
                className="border-thick border-border bg-background text-foreground hover:bg-primary hover:text-primary-foreground h-9 text-xs font-bold rounded-none shadow-none px-5"
              >
                閉じる
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* カメラQRスキャナーモーダル */}
      <QrScannerModal
        circleId="dummy"
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        mode="customer"
        onCustomerScanned={handleScannerScan}
      />
    </div>
  );
}
