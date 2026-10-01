import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { membershipApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FormField, FormSubmitButton } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";

interface CircleCreateLinkModalProps {
	eventId: string;
	isOpen: boolean;
	onClose: () => void;
}

const DEFAULT_MAX_USES = 1;
const DEFAULT_EXPIRES_IN_HOURS = 168;

/** 2026-10-01: サークル作成リンクは既存の circle_host 招待を使い、権限・期限・使用回数の判定を共有する。 */
export function CircleCreateLinkModal({ eventId, isOpen, onClose }: CircleCreateLinkModalProps) {
	const queryClient = useQueryClient();
	const [maxUses, setMaxUses] = useState(DEFAULT_MAX_USES);
	const [expiresInHours, setExpiresInHours] = useState(DEFAULT_EXPIRES_IN_HOURS);
	const [createdInvite, setCreatedInvite] = useState<{ token: string; code: string; expiresAt: string } | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		setMaxUses(DEFAULT_MAX_USES);
		setExpiresInHours(DEFAULT_EXPIRES_IN_HOURS);
		setCreatedInvite(null);
	}, [isOpen]);

	const createInviteMutation = useMutation({
		mutationFn: () =>
			membershipApi.createInvite({
				eventId,
				role: "circle_manager",
				maxUses: Math.min(100, Math.max(1, maxUses)),
				expiresInHours: Math.min(168, Math.max(1, expiresInHours)),
			}),
		onSuccess: (invite) => {
			setCreatedInvite({ ...invite, expiresAt: String(invite.expiresAt) });
			queryClient.invalidateQueries({ queryKey: ["invites", eventId] });
			toast.success("サークル作成リンクを発行しました");
		},
		onError: (error: Error) => toast.error(error.message || "リンクの発行に失敗しました"),
	});

	const inviteUrl = createdInvite
		? `${window.location.origin}/event/invite/${createdInvite.token}`
		: "";

	const copy = async (value: string, label: string) => {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(`${label}をコピーしました`);
		} catch {
			toast.error(`${label}をコピーできませんでした`);
		}
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={createdInvite ? "[サークル作成リンクを発行しました]" : "[サークル作成リンクを作成]"}
			subtitle="リンクを開いた人はログイン後、このイベントのサークル作成へ進みます。"
			maxWidth="md"
		>
			{createdInvite ? (
				<div className="space-y-4">
					<div className="border-thick border-border bg-muted/30 p-3 space-y-2">
						<p className="text-[10px] font-bold uppercase">[共有リンク]</p>
						<p className="break-all select-all text-xs">{inviteUrl}</p>
						<Button type="button" variant="outline" className="w-full rounded-none" onClick={() => copy(inviteUrl, "リンク")}>
							<Copy className="h-4 w-4" /> リンクをコピー
						</Button>
					</div>
					<div className="border-thick border-border p-3 space-y-2">
						<p className="text-[10px] font-bold uppercase">[招待コード]</p>
						<p className="flex items-center justify-between gap-2">
							<span className="select-all font-bold tracking-[3px]">{createdInvite.code}</span>
							<Button type="button" variant="outline" size="sm" className="rounded-none" onClick={() => copy(createdInvite.code, "招待コード")}>
								<Copy className="h-3.5 w-3.5" /> コピー
							</Button>
						</p>
					</div>
					<p className="text-[10px] text-muted-foreground">
						使用可能回数: {maxUses}回 / 有効期限: {new Date(createdInvite.expiresAt).toLocaleString("ja-JP")}
					</p>
					<div className="flex justify-end border-t-thick border-border pt-3">
						<Button type="button" variant="outline" className="rounded-none" onClick={onClose}>閉じる</Button>
					</div>
				</div>
			) : (
				<div className="space-y-4">
					<p className="border-thin border-border bg-muted/30 p-2 text-[11px] leading-relaxed text-muted-foreground">
						招待された人はアカウント作成またはログイン後、このイベントにサークルを登録できます。
					</p>
					<FormField
						id="circleInviteMaxUses"
						label="使用可能回数（作成できるサークル数）"
						type="number"
						min={1}
						max={100}
						value={maxUses}
						onChange={(event) => setMaxUses(Number(event.target.value))}
						placeholder="1"
					/>
					<FormField
						id="circleInviteExpiry"
						label="有効期限（時間）"
						type="number"
						min={1}
						max={168}
						value={expiresInHours}
						onChange={(event) => setExpiresInHours(Number(event.target.value))}
						placeholder="168"
					/>
					<FormSubmitButton
						onClick={() => createInviteMutation.mutate()}
						disabled={maxUses < 1 || maxUses > 100 || expiresInHours < 1 || expiresInHours > 168}
						isPending={createInviteMutation.isPending}
						icon={Link2}
					>
						サークル作成リンクを作成
					</FormSubmitButton>
				</div>
			)}
		</Modal>
	);
}
