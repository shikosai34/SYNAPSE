import { useEffect, useState } from "react";

interface LoaderProps {
	fullscreen?: boolean;
	message?: string;
}

// 2026-07-15: FesFlow の RawBlock デザインシステム (ブルータリズム・等幅フォント・太枠線・高コントラスト) 
// に調和した、プレミアムかつレトロなローディング画面へアップグレード。
export default function Loader({ fullscreen = false, message = "LOADING" }: LoaderProps) {
	const [dots, setDots] = useState("");

	useEffect(() => {
		const interval = setInterval(() => {
			setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
		}, 400);
		return () => clearInterval(interval);
	}, []);

	const content = (
		<div className="flex flex-col items-center justify-center p-sp-4 text-center font-mono">
			{/* RawBlockスタイルの太枠線と背景色のローディングボックス */}
			<div className="border-thick bg-background p-6 min-w-[280px] max-w-sm">
				<div className="text-xl font-bold uppercase tracking-[2px] mb-4 text-foreground">
					[{message}{dots}]
				</div>
				{/* 往復するインジケーターバー */}
				<div className="w-full h-4 bg-muted relative overflow-hidden border-thin">
					<div className="animate-rawblock-shimmer" />
				</div>
				<div className="text-[10px] text-placeholder mt-4 uppercase tracking-widest font-mono">
					Please wait while loading cache modules
				</div>
			</div>
		</div>
	);

	if (fullscreen) {
		return (
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
				{content}
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-[300px] items-center justify-center pt-8">
			{content}
		</div>
	);
}
