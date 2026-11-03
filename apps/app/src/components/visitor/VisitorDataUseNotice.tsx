import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { VISITOR_PROFILE_PURPOSES } from "@fesflow/config/visitor-profile";

const noticeTitle = "FesFlowにおける取得情報の利用目的と取扱いについて";

// 2026-10-20: 入場画面のダイアログとトップページの案内で同じ説明を使い、表示内容のずれを防ぐ。
export function VisitorDataUseNoticeContent() {
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <p>FesFlowでは、サービスの提供および運営のため、以下の情報を取得・利用します。</p>

      <dl className="space-y-3">
        <div className="border-b-thin border-border pb-3">
          <dt className="font-black">年代</dt>
          <dd className="mt-1 text-muted-foreground">{VISITOR_PROFILE_PURPOSES.ageGroup}</dd>
        </div>
        <div className="border-b-thin border-border pb-3">
          <dt className="font-black">ニックネーム</dt>
          <dd className="mt-1 text-muted-foreground">{VISITOR_PROFILE_PURPOSES.nickname}</dd>
        </div>
        <div>
          <dt className="font-black">グループ内のアレルギー情報（和集合）</dt>
          <dd className="mt-1 text-muted-foreground">{VISITOR_PROFILE_PURPOSES.allergies}</dd>
        </div>
      </dl>

      <p>取得した情報は、上記の目的に必要な範囲で利用します。</p>
      {/* 2026-11-03: 自動消去はこの案内で取得を明記したプロフィール・アレルギー情報を対象にする。 */}
      <p className="font-bold">これらの情報は、開催終了後、原則として1週間を目処に削除します。</p>
    </div>
  );
}

export function VisitorDataUseNoticeButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full border-thick border-border bg-background px-3 py-2 text-xs font-bold leading-relaxed underline underline-offset-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        {noticeTitle}
      </button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title={`[${noticeTitle}]`} maxWidth="md">
        <VisitorDataUseNoticeContent />
      </Modal>
    </>
  );
}

export default function VisitorDataUseNoticePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 font-mono">
      <article className="space-y-6">
        <h1 className="text-xl font-black leading-relaxed sm:text-2xl">{noticeTitle}</h1>
        <VisitorDataUseNoticeContent />
      </article>
    </main>
  );
}
