import { useState, useEffect, useRef } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { wristbandApi, type WristbandBatch, type WristbandLookupResult } from "@/lib/api";
import { extractIdFromCode } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  RefreshCw,
  Camera,
  Plus,
  Smartphone,
  Loader2,
  IdCard,
  Copy,
  ChevronRight,
  Edit,
  FileUp,
} from "lucide-react";
import { toast } from "sonner";
import { QrScannerModal } from "@/components/pos/qr-scanner-modal";
import { Modal } from "@/components/ui/Modal";
import { QRCodeSVG } from "qrcode.react";
import { digitalQrIssueUrl } from "@/lib/digital-qr-url";
import { visitorUrl } from "@/lib/visitor-url";
import { generateWristbandIds } from "@/lib/wristband-id-generator";
import { WristbandBatchHistory } from "@/components/event/WristbandBatchHistory";
import { VisitorRecordEditor } from "@/components/event/VisitorRecordEditor";
import { visitorAgeGroupLabel } from "@fesflow/config/visitor-profile";

interface WristbandsTabProps {
  eventId: string;
  hasPhysicalWristband?: boolean;
  allowSelfIssue?: boolean;
  canManageWristbands?: boolean;
}

type VisitorFilters = {
  bandType: "all" | "physical" | "smartphone" | "unlinked";
  accountStatus: "all" | "available" | "banned";
  profileStatus: "all" | "complete" | "pending";
};

type VisitorSortField = "createdAt" | "displayId" | "nickname" | "favoriteDate" | "ageGroup" | "onboardedAt" | "accountStatus" | "wristbandId" | "bandStatus";

const VISITOR_PAGE_SIZE = 500;
// D1は1クエリあたりのバインド変数が100個まで。親行は4列を明示するため、
// スキーマ変更にも余裕を残して20件ずつ取り込む。
const WRISTBAND_GENERATION_MAX_COUNT = 50_000;
const VISITOR_SORT_COLUMNS: { label: string; field: Exclude<VisitorSortField, "createdAt"> }[] = [
  { label: "呼出ID", field: "displayId" },
  { label: "ニックネーム", field: "nickname" },
  { label: "お好きな日付", field: "favoriteDate" },
  { label: "年代", field: "ageGroup" },
  { label: "入場登録", field: "onboardedAt" },
  { label: "アカウント状態", field: "accountStatus" },
  { label: "紐付くバンドID", field: "wristbandId" },
  { label: "バンド状態", field: "bandStatus" },
];

export function WristbandsTab({ eventId, hasPhysicalWristband = true, allowSelfIssue = true, canManageWristbands = true }: WristbandsTabProps) {
  const queryClient = useQueryClient();

  // 検索・表示関連の状態
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // 2026-10-02: 5000件規模の来場者でも状態別に探せるよう、一覧APIに絞り込み条件を渡す。
  const [filters, setFilters] = useState<VisitorFilters>({
    bandType: "all",
    accountStatus: "all",
    profileStatus: "all",
  });
  // 2026-10-02: 多数の来場者を連続して確認できるよう、500件ずつ追加取得する。
  const [visitorSort, setVisitorSort] = useState<{ field: VisitorSortField; direction: "asc" | "desc" }>({
    field: "createdAt",
    direction: "desc",
  });
  const [isVisitorTableOpen, setIsVisitorTableOpen] = useState(false);
  const [isBatchHistoryOpen, setIsBatchHistoryOpen] = useState(false);
  const visitorScrollContainerRef = useRef<HTMLDivElement>(null);
  const visitorLoadMoreRef = useRef<HTMLDivElement>(null);

  // モーダル開閉状態
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<"search" | "lookup">("lookup");

  // スキャン・照会モーダル用の手入力コード
  const [lookupCode, setLookupCode] = useState("");

  // 詳細編集モーダル用の状態
  const [selectedUser, setSelectedUser] = useState<WristbandLookupResult | null>(null);

  // 新規スマホ用来場者発行モーダル用の状態
  const [issuedUser, setIssuedUser] = useState<{ userId: string; displayId: number } | null>(null);
  const [generatedPrefix, setGeneratedPrefix] = useState("");
  const [generatedCount, setGeneratedCount] = useState(10_000);
  const [suffixLengthMode, setSuffixLengthMode] = useState("16");
  const [manualSuffixLength, setManualSuffixLength] = useState(16);
  const [csvPreview, setCsvPreview] = useState<{
    fileName: string;
    fileSize: number;
    urls: string[];
    duplicateCount: number;
    duplicateLines: number[];
    invalidLines: number[];
  } | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [activeBatchProgress, setActiveBatchProgress] = useState<WristbandBatch | null>(null);

  // 来場者一覧・検索クエリ (React Query を使って自動フェッチ&キャッシュ)
  const {
    data: visitorSearch,
    isLoading,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["eventVisitors", eventId, searchQuery, filters, visitorSort],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => wristbandApi.search(eventId, searchQuery, filters, {
      offset: pageParam,
      limit: VISITOR_PAGE_SIZE,
    }, {
      sortBy: visitorSort.field,
      sortDirection: visitorSort.direction,
    }),
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.items.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
  });
  const visitors = visitorSearch?.pages.flatMap((page) => page.items) ?? [];
  const visitorTotal = visitorSearch?.pages[0]?.total ?? 0;

  // 2026-10-02: 条件変更後は先頭から読み進め、前のスクロール位置による連続取得を防ぐ。
  useEffect(() => {
    if (isVisitorTableOpen && visitorScrollContainerRef.current) {
      visitorScrollContainerRef.current.scrollTop = 0;
    }
  }, [filters, isVisitorTableOpen, searchQuery, visitorSort]);

  // 2026-10-02: 一覧のスクロール領域末尾を監視し、次の500件を自動取得する。ボタン操作も併設してキーボード利用を保つ。
  useEffect(() => {
    const root = visitorScrollContainerRef.current;
    const target = visitorLoadMoreRef.current;
    if (!isVisitorTableOpen || !root || !target || !hasNextPage || isFetchingNextPage) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void fetchNextPage();
      },
      { root, rootMargin: "0px 0px 200px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isVisitorTableOpen]);

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

  const batchOperationMutation = useMutation({
    mutationFn: async (operation:
      | { mode: "create"; source: "generated" | "csv"; urls: string[]; prefix?: string; suffixLength?: number }
      | { mode: "resume"; batchId: string }
    ) => {
      let batch = operation.mode === "create"
        ? await wristbandApi.createBatch({
            eventId,
            source: operation.source,
            prefix: operation.prefix,
            suffixLength: operation.suffixLength,
            urls: operation.urls,
          })
        : { id: operation.batchId } as WristbandBatch;

      setActiveBatchId(batch.id);
      if (operation.mode === "create") {
        setActiveBatchProgress(batch);
        setIsImportModalOpen(false);
        setIsGenerateModalOpen(false);
      }

      while (batch.status !== "completed" && batch.status !== "conflict") {
        batch = await wristbandApi.processBatch(batch.id);
        setActiveBatchProgress(batch);
      }
      return batch;
    },
    onSuccess: (batch) => {
      if (batch.status === "completed") {
        toast.success(`${batch.importedCount.toLocaleString("ja-JP")}件のリストバンドを登録しました。CSVは履歴から再取得できます。`);
      } else {
        toast.error(batch.errorMessage || "登録済みIDが見つかりました。CSVを確認してください。");
      }
      queryClient.invalidateQueries({ queryKey: ["eventVisitors"] });
    },
    onError: (error: any) => {
      toast.error(error?.message || "登録が中断されました。履歴から再開できます。");
    },
    onSettled: () => {
      setActiveBatchId(null);
      setActiveBatchProgress(null);
      queryClient.invalidateQueries({ queryKey: ["wristbandBatchHistory", eventId] });
    },
  });

  const handleImportCsv = async (file: File) => {
    try {
      const text = (await file.text()).replace(/^\uFEFF/, "");
      const rows = text.split(/\r?\n/).map((line, index) => ({
        line: index + 1,
        value: line.trim().replace(/^"|"$/g, ""),
      })).filter(({ value }) => value && value.toLowerCase() !== "url");
      const seen = new Set<string>();
      const duplicateLines: number[] = [];
      const invalidLines: number[] = [];
      const urls = rows.map(({ line, value }) => {
        const id = extractIdFromCode(value);
        if (!/^[a-zA-Z0-9_-]+$/.test(id) || (value.includes("/w/") && !/\/w\/[a-zA-Z0-9_-]+(?:[?#].*)?$/.test(value))) {
          invalidLines.push(line);
        }
        if (seen.has(id)) duplicateLines.push(line);
        seen.add(id);
        return value;
      });
      setCsvPreview({
        fileName: file.name,
        fileSize: file.size,
        urls,
        duplicateCount: duplicateLines.length,
        duplicateLines,
        invalidLines,
      });
    } catch {
      setCsvPreview(null);
      toast.error("CSVファイルを読み取れませんでした。別のファイルを選択してください。");
    }
  };

  const startCsvImport = () => {
    if (!csvPreview || csvPreview.urls.length === 0 || csvPreview.duplicateCount > 0 || csvPreview.invalidLines.length > 0) return;
    batchOperationMutation.mutate({ mode: "create", source: "csv", urls: csvPreview.urls });
  };

  const handleGenerateWristbandIds = () => {
    try {
      const prefix = generatedPrefix.trim();
      const suffixLength = suffixLengthMode === "custom" ? manualSuffixLength : Number(suffixLengthMode);
      const ids = generateWristbandIds(prefix, generatedCount, suffixLength);
      const urls = ids.map((id) => getVisitorLink(id));
      batchOperationMutation.mutate({ mode: "create", source: "generated", prefix, suffixLength, urls });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "リストバンドIDの生成に失敗しました");
    }
  };

  const handleScannerScan = (userId: string, wristbandId: string | null) => {
    const code = wristbandId || userId;
    if (scannerTarget === "lookup") {
      setLookupCode(code);
      lookupMutation.mutate(code);
    } else if (scannerTarget === "search") {
      setSearchInput(code);
      setSearchQuery(code);
    }
  };

  const closeDetailsModal = () => {
    setIsDetailsModalOpen(false);
    setSelectedUser(null);
  };

  // 2026-10-01: 登録来場者一覧の先頭列からプロフィール編集を開けるようにする。
  const handleOpenVisitorDetails = (visitor: WristbandLookupResult) => {
    setIsVisitorTableOpen(false);
    setSelectedUser(visitor);
    setIsDetailsModalOpen(true);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput.trim());
  };

  const handleResetSearch = () => {
    setSearchInput("");
    setSearchQuery("");
  };

  const handleResetFilters = () => {
    setFilters({ bandType: "all", accountStatus: "all", profileStatus: "all" });
  };

  const getVisitorLink = (userId: string) => {
    return visitorUrl(`/w/${userId}`);
  };
  // 2026-09-27 Issue #56: QRの内容を表示中の発行URLと同じ MyPage 発行アクションに揃える。
  const selfIssueUrl = digitalQrIssueUrl(window.location.origin, eventId);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("クリップボードにコピーしました");
  };

  const handleVisitorSort = (field: Exclude<VisitorSortField, "createdAt">) => {
    setVisitorSort((current) => ({
      field,
      direction: current.field === field && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  return (
    <div className="space-y-6 font-mono text-foreground">
      {/* 画面ヘッダー部 */}
      <div className="flex max-w-full flex-col gap-4 border-b-thick border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <IdCard className="h-4 w-4" />
            来場者・リストバンド管理
          </h2>
          <p className="text-[10px] text-muted-foreground mt-1">
            来場者アカウント情報とバンド登録を管理します。
          </p>
        </div>
        <div className="flex w-full max-w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {/* 2026-10-20: 紛失交換は独立画面へ分離したため、一覧に重複導線を置かない。 */}
          <Button
            onClick={() => {
              setLookupCode("");
              setIsScanModalOpen(true);
            }}
            variant="outline"
            className="w-full sm:w-auto border-thick border-border h-9 text-xs font-bold rounded-none shadow-none px-3"
          >
            <Camera className="h-4 w-4 mr-1.5" />
            コード照会 / QRスキャン
          </Button>
        </div>
      </div>

      {/* 2026-10-25: 登録済み来場者一覧を受付準備より先に置き、運用中に必要な確認へすぐ移れるようにする。 */}
      <Card className="rounded-none bg-background shadow-none border-thick border-border">
        <CardHeader className="p-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-xs uppercase font-bold">登録済み来場者</CardTitle>
            <CardDescription className="text-[10px]">
              {visitors.length}件読み込み済み / 全{visitorTotal}件{searchQuery ? "（検索条件あり）" : ""}
            </CardDescription>
          </div>
          <Button
            onClick={() => setIsVisitorTableOpen(true)}
            variant="outline"
            className="h-12 w-full border-thick border-border text-sm font-bold rounded-none sm:w-auto sm:min-w-64"
          >
            一覧を開く（全{visitorTotal}件）
          </Button>
        </CardHeader>
      </Card>

      {/* 2026-10-16: イベント設定を運用の基準にし、使わない物理バンド手順を隠して受付準備の迷いを減らす。 */}
      {/* 2026-10-25: 交換・景品交換担当には管理画面を閲覧用で開き、発行や編集は member:write に限定する。 */}
      {canManageWristbands && <section aria-labelledby="wristband-provisioning-title" className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 id="wristband-provisioning-title" className="text-xs font-bold uppercase tracking-wider">
              来場者の登録・受付準備
            </h3>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {hasPhysicalWristband
                ? "物理バンドを配布するか、スマートフォンで登録するかを選べます。"
                : "このイベントはスマートフォンで受付します。セルフ登録QRを掲示するか、スタッフが個別発行してください。"}
            </p>
          </div>
          <Badge variant="default" className="w-fit rounded-none border-thick border-border text-[10px] font-bold">
            {hasPhysicalWristband ? "物理バンド利用あり" : "スマートフォン受付"}
          </Badge>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className={`rounded-none bg-background shadow-none border-thick border-border ${hasPhysicalWristband ? "order-2" : "order-1 xl:col-span-2"}`}>
            <CardHeader className="p-4 border-b-thin border-border bg-info/5">
              <CardTitle className="flex items-center gap-2 text-xs font-bold uppercase">
                <Smartphone className="h-4 w-4" />
                スマートフォンで登録
              </CardTitle>
              <CardDescription className="text-[10px]">
                物理バンドを使わず、スマートフォンでQRを読み取って来場者登録します。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              {allowSelfIssue ? (
                <>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      受付にQRを掲示するか、スタッフが個別に来場者アカウントを発行できます。
                    </p>
                    <Button
                      onClick={() => {
                        setIssuedUser(null);
                        setIsIssueModalOpen(true);
                      }}
                      className="w-full shrink-0 border-thick border-primary bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-background hover:text-foreground sm:w-auto"
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      個別に発行
                    </Button>
                  </div>
                  <div className="border-t-thin border-border pt-4">
                    <div className="flex flex-col items-center gap-4 md:flex-row">
                      <div className="shrink-0 border-thick border-border bg-white p-3">
                        <QRCodeSVG value={selfIssueUrl} size={128} level="M" />
                      </div>
                      <div className="min-w-0 space-y-2 text-xs">
                        <p className="font-bold underline">受付用セルフ登録QR</p>
                        <p className="break-all border border-border bg-muted p-2 select-all">{selfIssueUrl}</p>
                        <p className="text-[10px] leading-relaxed text-muted-foreground">
                          来場者が読み取るとスマホ用IDが発行され、プロフィール登録へ進みます。
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <p role="status" className="border-thin border-border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
                  {/* 2026-10-20: OFFの理由に加え、利用再開に必要な設定場所と操作をその場で案内する。 */}
                  来場者のQRセルフ発行はOFFです。利用する場合はイベント設定で「来場者のQRセルフ発行を許可する」をONにしてください。
                </p>
              )}
            </CardContent>
          </Card>

          {hasPhysicalWristband && <Card className="order-1 rounded-none bg-background shadow-none border-thick border-border">
            <CardHeader className="p-4 border-b-thin border-border bg-success/5">
              <CardTitle className="flex items-center gap-2 text-xs font-bold uppercase">
                <IdCard className="h-4 w-4" />
                リストバンドで登録
              </CardTitle>
              <CardDescription className="text-[10px]">
                印刷したバンドのURLを先に取り込み、来場者がバンドのQRを読み取って登録します。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4 p-4">
              <div className="space-y-2 text-[10px] leading-relaxed text-muted-foreground">
                <p>1. 印刷用CSVを取り込み、URLと来場者枠を登録します。</p>
                <p>2. 印刷したリストバンドを来場者へ渡します。</p>
                <p>3. バンドのQR読み取り後、初回プロフィール登録へ進みます。</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                  onClick={() => setIsImportModalOpen(true)}
                  disabled={batchOperationMutation.isPending}
                  variant="outline"
                  className="w-full self-start border-thick border-border text-xs font-bold sm:w-auto"
                >
                  <FileUp className="mr-1.5 h-4 w-4" />
                  リストバンドURL CSVを取り込む
                </Button>
                <Button
                  disabled={batchOperationMutation.isPending}
                  onClick={() => {
                    setIsGenerateModalOpen(true);
                  }}
                  className="w-full self-start border-thick border-primary bg-primary text-xs font-bold text-primary-foreground hover:bg-background hover:text-foreground sm:w-auto"
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  人数を指定してID生成
                </Button>
              </div>
              {activeBatchProgress && (
                <div role="status" aria-live="polite" className="border-thin border-border bg-muted/20 p-3 text-xs">
                  <div className="flex items-center gap-2 font-bold">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    リストバンドを登録中
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {activeBatchProgress.processedCount.toLocaleString("ja-JP")} / {activeBatchProgress.totalCount.toLocaleString("ja-JP")} 件
                  </p>
                </div>
              )}
              <div className="border-t-thick border-border pt-4">
                <Button type="button" variant="outline" className="w-full border-thick border-border text-xs font-bold" onClick={() => setIsBatchHistoryOpen(true)}>
                  発行・取込履歴を開く
                </Button>
                <p className="mt-2 text-[10px] text-muted-foreground">CSVの再取得や、未完了の登録を続けられます。</p>
              </div>
            </CardContent>
          </Card>}
        </div>
      </section>}

      <Modal
        isOpen={isBatchHistoryOpen}
        onClose={() => setIsBatchHistoryOpen(false)}
        title="[発行・取込履歴]"
        subtitle="画面を閉じた後もCSVを再取得し、未完了の登録を続けられます。"
        maxWidth="xl"
      >
        <WristbandBatchHistory
          eventId={eventId}
          activeBatchId={activeBatchId}
          onResume={(batch) => batchOperationMutation.mutate({ mode: "resume", batchId: batch.id })}
        />
      </Modal>

      <Modal
        isOpen={isImportModalOpen}
        title="CSVからリストバンド情報を取り込む"
        subtitle="印刷用URL CSVを取り込むと、このイベントの来場者とリストバンドを一括登録します。"
        onClose={() => !batchOperationMutation.isPending && setIsImportModalOpen(false)}
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="border-thin border-border bg-muted/20 p-3 text-[11px] leading-relaxed">
            <p className="font-bold">対応形式</p>
            <p>1列目がURLのCSV（ヘッダー「url」は任意）</p>
            <p>例: https://fesflow.shikosai.net/w/34-0001</p>
            <p className="text-muted-foreground">選択後に内容を確認できます。登録済みIDがある場合は安全のためそのバッチを停止します。</p>
          </div>
          <label className="flex cursor-pointer items-center justify-center gap-2 border-thick border-dashed border-border p-6 text-xs font-bold hover:bg-muted/30">
            <FileUp className="h-5 w-5" />
            CSVファイルを選択
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={batchOperationMutation.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImportCsv(file);
                event.target.value = "";
              }}
            />
          </label>
          {csvPreview && (
            <section aria-label="CSVの確認" className="space-y-3 border-thin border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-all text-xs font-bold">{csvPreview.fileName}</p>
                  <p className="text-[10px] text-muted-foreground">{(csvPreview.fileSize / 1024).toLocaleString("ja-JP", { maximumFractionDigits: 1 })} KB</p>
                </div>
                <Badge variant="default" className="shrink-0 rounded-none border-thin">
                  {csvPreview.urls.length.toLocaleString("ja-JP")} 件
                </Badge>
              </div>
              {csvPreview.urls.length === 0 ? (
                <p role="alert" className="text-xs text-error">有効なURLが見つかりません。1行に1つ、/w/ID形式のURLが入ったCSVを選択してください。</p>
              ) : csvPreview.duplicateCount === 0 && csvPreview.invalidLines.length === 0 ? (
                <p className="text-xs text-success">URL形式と重複を確認しました。この内容で登録できます。</p>
              ) : (
                <div role="alert" className="space-y-1 text-xs text-error">
                  {csvPreview.duplicateCount > 0 && <p>重複URLが {csvPreview.duplicateCount} 件あります（{csvPreview.duplicateLines.slice(0, 5).join(", ")}{csvPreview.duplicateLines.length > 5 ? "…" : ""} 行目）。CSVを修正してください。</p>}
                  {csvPreview.invalidLines.length > 0 && <p>URL形式が正しくない行が {csvPreview.invalidLines.length} 件あります（{csvPreview.invalidLines.slice(0, 5).join(", ")}{csvPreview.invalidLines.length > 5 ? "…" : ""} 行目）。</p>}
                </div>
              )}
              <div className="flex flex-col gap-2 border-t-thin border-border pt-3 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" disabled={batchOperationMutation.isPending} onClick={() => setCsvPreview(null)} className="h-10 border-thick border-border text-xs">
                  ファイルを選び直す
                </Button>
                <Button
                  type="button"
                  disabled={batchOperationMutation.isPending || csvPreview.urls.length === 0 || csvPreview.duplicateCount > 0 || csvPreview.invalidLines.length > 0}
                  onClick={startCsvImport}
                  className="h-10 border-thick border-primary bg-primary text-xs font-bold text-primary-foreground hover:bg-background hover:text-foreground"
                >
                  {batchOperationMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  確認して登録
                </Button>
              </div>
            </section>
          )}
          {batchOperationMutation.isError && <p role="alert" className="text-xs text-error">登録を完了できませんでした。登録済みの分は履歴から再開できます。</p>}
        </div>
      </Modal>

      <Modal
        isOpen={isGenerateModalOpen}
        title="リストバンドIDをまとめて発行"
        subtitle="イベント固有IDとランダム文字列を組み合わせ、登録と印刷用CSVの作成を行います。"
        onClose={() => !batchOperationMutation.isPending && setIsGenerateModalOpen(false)}
        maxWidth="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="wristband-id-prefix" className="text-xs font-bold">イベント固有ID</label>
              <Input
                id="wristband-id-prefix"
                value={generatedPrefix}
                onChange={(event) => setGeneratedPrefix(event.target.value)}
                placeholder="例: 34"
                autoComplete="off"
                maxLength={32}
                required
                aria-describedby="wristband-id-prefix-help"
                className="h-10 border-thick border-border bg-background text-xs font-mono"
              />
              <p id="wristband-id-prefix-help" className="text-[10px] text-muted-foreground">
                URLで使える半角英数字・ハイフン・アンダースコア。IDは「入力値-ランダム文字列」になります。
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor="wristband-id-count" className="text-xs font-bold">発行人数</label>
              <Input
                id="wristband-id-count"
                type="number"
                min={1}
                max={WRISTBAND_GENERATION_MAX_COUNT}
                step={1}
                value={generatedCount}
                onChange={(event) => setGeneratedCount(event.target.value === "" ? 0 : Number(event.target.value))}
                aria-describedby="wristband-id-count-help"
                className="h-10 border-thick border-border bg-background text-xs font-mono"
              />
              <p id="wristband-id-count-help" className="text-[10px] text-muted-foreground">1〜50,000人</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="wristband-id-length" className="text-xs font-bold">ランダム文字列の長さ</label>
              <select
                id="wristband-id-length"
                value={suffixLengthMode}
                onChange={(event) => setSuffixLengthMode(event.target.value)}
                className="h-10 w-full border-thick border-border bg-background px-2 text-xs font-mono"
              >
                <option value="8">8文字（40 bit）</option>
                <option value="10">10文字（50 bit）</option>
                <option value="12">12文字（60 bit）</option>
                <option value="16">16文字（80 bit・おすすめ）</option>
                <option value="custom">手動で指定</option>
              </select>
            </div>
            {suffixLengthMode === "custom" && (
              <div className="space-y-1">
                <label htmlFor="wristband-id-custom-length" className="text-xs font-bold">文字数（4〜32）</label>
                <Input
                  id="wristband-id-custom-length"
                  type="number"
                  min={4}
                  max={32}
                  step={1}
                  value={manualSuffixLength}
                  onChange={(event) => setManualSuffixLength(event.target.value === "" ? 0 : Number(event.target.value))}
                  className="h-10 border-thick border-border bg-background text-xs font-mono"
                />
              </div>
            )}
          </div>

          <div className="border-thin border-border bg-muted/20 p-3 text-[10px] leading-relaxed">
            <p className="font-bold">生成例</p>
            <p className="break-all font-mono">{generatedPrefix.trim() || "イベントID"}-{suffixLengthMode === "custom" ? "A1B2".repeat(Math.ceil(manualSuffixLength / 4)).slice(0, manualSuffixLength) : "A1B2".repeat(Math.ceil(Number(suffixLengthMode) / 4)).slice(0, Number(suffixLengthMode))}</p>
            <p className="mt-1 text-muted-foreground">暗号学的乱数を使います。登録開始前にURLを履歴へ保存するため、画面を閉じても後からCSVを再取得できます。</p>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t-thin border-border pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsGenerateModalOpen(false)}
              disabled={batchOperationMutation.isPending}
              className="h-10 border-thick border-border px-4 text-xs font-bold"
            >
              閉じる
            </Button>
            <Button
              type="button"
              onClick={handleGenerateWristbandIds}
              disabled={
                batchOperationMutation.isPending ||
                !generatedPrefix.trim() ||
                generatedCount < 1 ||
                generatedCount > WRISTBAND_GENERATION_MAX_COUNT ||
                !Number.isInteger(generatedCount) ||
                (suffixLengthMode === "custom" &&
                  (manualSuffixLength < 4 || manualSuffixLength > 32 || !Number.isInteger(manualSuffixLength)))
              }
              className="h-10 border-thick border-primary bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-background hover:text-foreground"
            >
              {batchOperationMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              IDを生成して登録
            </Button>
          </div>
        </div>
      </Modal>

      {/* 2026-09-27: 来場者の行が画面を押し下げないよう、検索と編集操作を表モーダルにまとめる。 */}
      <Modal
        isOpen={isVisitorTableOpen}
        onClose={() => setIsVisitorTableOpen(false)}
        title="登録済み来場者"
        subtitle={`全${visitorTotal}件`}
        maxWidth="full"
        contentClassName="min-h-0 flex flex-col overflow-y-auto"
      >
      {/* 2026-10-20: 検索・絞り込みの下に画面高の一覧を置く。先に条件を指定し、その後一覧領域へ移動して行を探せるようにする。 */}
      <div className="flex shrink-0 flex-col gap-4">
      {/* 検索バー */}
      <Card className="shrink-0 gap-0 rounded-none bg-background shadow-none border-thick border-border p-0">
        <CardContent className="p-2 sm:p-4">
          {/* 2026-09-27: 狭い画面では検索欄を独立行へ折り返し、操作ボタンの幅を確保する。 */}
          <form onSubmit={handleSearchSubmit} className="flex min-w-0 flex-wrap gap-1.5 sm:gap-2">
            <div className="relative min-w-0 basis-full sm:basis-0 sm:flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ニックネーム、呼出ID（数字のみ）、またはお好きな日付（YYYY-MM-DD）で検索..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="min-w-0 w-full pl-9 border-thick border-border rounded-none focus-visible:ring-0 h-9 sm:h-10 text-xs bg-background font-mono"
              />
            </div>
            <Button
              type="submit"
              disabled={isLoading}
              className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-9 sm:h-10 text-xs font-bold rounded-none shadow-none px-5"
            >
              検索
            </Button>
            {(searchQuery || searchInput) && (
              <Button
                type="button"
                onClick={handleResetSearch}
                variant="outline"
                className="border-thick border-border h-9 sm:h-10 text-xs font-bold rounded-none shadow-none px-3"
              >
                クリア
              </Button>
            )}
            <Button
              type="button"
              onClick={() => refetch()}
              variant="outline"
              disabled={isLoading}
              className="border-thick border-border h-9 sm:h-10 px-3 rounded-none"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="shrink-0 gap-0 rounded-none bg-background shadow-none border-thick border-border p-0">
        <CardContent className="space-y-1.5 p-2 sm:space-y-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase">一覧を絞り込む</p>
            <Button
              type="button"
              variant="outline"
              onClick={handleResetFilters}
              disabled={filters.bandType === "all" && filters.accountStatus === "all" && filters.profileStatus === "all"}
              className="h-7 sm:h-8 border-thick border-border px-3 text-[10px] font-bold"
            >
              フィルターをクリア
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 sm:gap-3">
            <label className="space-y-0.5 text-[10px] font-bold sm:space-y-1">
              <span className="block">登録方法</span>
              <select
                aria-label="登録方法で絞り込む"
                value={filters.bandType}
                onChange={(event) => {
                  setFilters((current) => ({ ...current, bandType: event.target.value as VisitorFilters["bandType"] }));
                }}
                className="h-9 sm:h-10 w-full border-thick border-border bg-background px-2 text-xs font-mono focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <option value="all">すべて</option>
                <option value="physical">物理リストバンド</option>
                <option value="smartphone">スマホ</option>
                <option value="unlinked">有効なIDなし</option>
              </select>
            </label>
            <label className="space-y-0.5 text-[10px] font-bold sm:space-y-1">
              <span className="block">アカウント状態</span>
              <select
                aria-label="アカウント状態で絞り込む"
                value={filters.accountStatus}
                onChange={(event) => {
                  setFilters((current) => ({ ...current, accountStatus: event.target.value as VisitorFilters["accountStatus"] }));
                }}
                className="h-9 sm:h-10 w-full border-thick border-border bg-background px-2 text-xs font-mono focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <option value="all">すべて</option>
                <option value="available">利用可能</option>
                <option value="banned">利用停止</option>
              </select>
            </label>
            <label className="space-y-0.5 text-[10px] font-bold sm:space-y-1">
              <span className="block">プロフィール登録</span>
              <select
                aria-label="プロフィール登録状態で絞り込む"
                value={filters.profileStatus}
                onChange={(event) => {
                  setFilters((current) => ({ ...current, profileStatus: event.target.value as VisitorFilters["profileStatus"] }));
                }}
                className="h-9 sm:h-10 w-full border-thick border-border bg-background px-2 text-xs font-mono focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <option value="all">すべて</option>
                <option value="complete">登録済み</option>
                <option value="pending">未登録</option>
              </select>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* 来場者一覧テーブル */}
      <Card className="flex h-[calc(100dvh-7rem)] min-h-[calc(100dvh-7rem)] shrink-0 flex-col gap-0 rounded-none bg-background shadow-none border-thick border-border p-0">
        <CardHeader className="p-2 pb-1 border-b-thin border-border bg-muted/20 flex flex-col items-start gap-2 sm:p-4 sm:pb-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-xs uppercase font-bold">登録済み来場者</CardTitle>
            <CardDescription className="text-[10px]">
              {searchQuery
                ? `検索条件「${searchQuery}」とフィルターの検索結果`
                : "フィルター条件に一致した最近の来場者"}
              {`（${visitors.length}件読み込み済み / 全${visitorTotal}件）`}
            </CardDescription>
          </div>
          <Badge variant="default" className="border-thick border-border font-bold text-[10px] rounded-none">
            {visitorTotal} 件
          </Badge>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {/* 2026-10-20: 一覧カードを画面高に近い固定領域にし、多数の来場者を一覧内で探せるようにする。 */}
          <div ref={visitorScrollContainerRef} className="min-h-0 flex-1 overflow-auto">
            {isLoading ? (
              <div className="p-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                データを読み込み中...
              </div>
            ) : isError ? (
              <div role="alert" className="flex flex-col items-center gap-3 p-8 text-center text-xs text-error">
                <p>{error instanceof Error ? error.message : "来場者一覧を読み込めませんでした。"}</p>
                <Button type="button" variant="outline" onClick={() => refetch()} className="border-thick border-border">
                  再読み込み
                </Button>
              </div>
            ) : visitors.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                該当する来場者が見つかりません。
              </div>
            ) : (
              <table className="w-full min-w-[880px] text-xs text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-background">
                  <tr className="border-b-thin border-border bg-muted/10 font-bold font-mono">
                    {/* 2026-10-25: 受付済み状態と年代を利用可能状態・好きな日付と区別して確認できる列として示す。 */}
                    {VISITOR_SORT_COLUMNS.map(({ label, field }) => (
                      <th
                        key={field}
                        scope="col"
                        aria-sort={visitorSort.field === field ? (visitorSort.direction === "asc" ? "ascending" : "descending") : "none"}
                        className="p-3"
                      >
                        <button
                          type="button"
                          onClick={() => handleVisitorSort(field)}
                          className="inline-flex items-center gap-1 text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          {label}
                          <span aria-hidden="true">{visitorSort.field === field ? (visitorSort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visitors.map((res: any) => (
                    <tr key={res.user.id} className="border-b-thin border-border hover:bg-muted/5 font-mono">
                      <td className="p-3 font-bold">
                        <div className="flex items-center gap-2">
                          <span>#{res.user.displayId}</span>
                          {canManageWristbands && <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenVisitorDetails(res)}
                              aria-label={`来場者 #${res.user.displayId}を編集`}
                              className="h-7 rounded-none border-thick border-border px-2 text-[10px]"
                            >
                              <Edit className="mr-1 h-3 w-3" />
                              編集
                            </Button>}
                        </div>
                      </td>
                      <td className="p-3">{res.user.nickname || <span className="text-muted-foreground text-[10px]">未登録</span>}</td>
                      <td className="p-3">{res.user.favoriteDate || <span className="text-muted-foreground text-[10px]">未登録</span>}</td>
                      <td className="p-3">{visitorAgeGroupLabel(res.user.ageGroup)}</td>
                      <td className="p-3">
                        <Badge
                          variant="default"
                          className={`rounded-none text-[8px] font-mono border-thick ${res.user.onboardedAt
                            ? "bg-success/10 text-success border-success"
                            : "bg-warning/10 text-warning border-warning"
                          }`}
                        >
                          {res.user.onboardedAt ? "入場登録済み" : "入場未登録"}
                        </Badge>
                      </td>
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
                      <td className="p-3 font-mono text-[11px] select-all">
                        {/* 2026-10-18: 家族アカウント内の物理・スマホ両方のIDを一覧に出し、先頭以外の発行済みバンドを見落とさないようにする。 */}
                        {(res.familyWristbands?.length ? res.familyWristbands : res.wristband ? [res.wristband] : []).length > 0 ? (
                          <div className="space-y-1">
                            {(res.familyWristbands?.length ? res.familyWristbands : [res.wristband]).map((band: NonNullable<typeof res.wristband>) => (
                              <div key={band.id} className="flex flex-wrap items-center gap-x-2">
                                <span>{band.id}</span>
                                {band.status === "smartphone" && <span className="text-[9px] text-info">スマホ</span>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">なし</span>
                        )}
                        {(res.familyBandCount ?? res.familyWristbands?.length ?? 0) > 1 && <span className="ml-2 text-[9px] text-muted-foreground">家族 {res.familyBandCount ?? res.familyWristbands?.length ?? 0}人</span>}
                      </td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!isLoading && visitors.length > 0 && (
              <div ref={visitorLoadMoreRef} className="flex flex-col items-center gap-2 border-t-thin border-border p-4 text-center">
                <p role="status" aria-live="polite" className="text-[10px] text-muted-foreground">
                  {isFetchingNextPage
                    ? `${visitors.length} / ${visitorTotal} 件を表示中 — 続きを読み込み中...`
                    : hasNextPage
                    ? `${visitors.length} / ${visitorTotal} 件を表示中 — 下へスクロールすると続きが読み込まれます`
                    : `全${visitorTotal}件を表示しました`}
                </p>
                {hasNextPage && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="h-10 border-thick border-border px-4 text-xs font-bold"
                  >
                    {isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isFetchingNextPage ? "読み込み中..." : `さらに${VISITOR_PAGE_SIZE}件を読み込む`}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      </div>
      </Modal>

      {/* ==========================================
          1. 照会・スキャンモーダル
         ========================================== */}
      <Modal
        isOpen={isScanModalOpen}
        title="来場者情報をスキャン"
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
        title="スマートフォン用の来場者QRを発行"
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

      {isDetailsModalOpen && selectedUser?.user && (
        <VisitorRecordEditor
          key={selectedUser.user.id}
          eventId={eventId}
          userId={selectedUser.user.id}
          onClose={closeDetailsModal}
        />
      )}

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
