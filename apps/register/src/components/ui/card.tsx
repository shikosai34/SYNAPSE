import * as React from "react";

import { cn } from "@/lib/utils";

import { cva, type VariantProps } from "class-variance-authority";

// 2026-07-06: 「枠が見えない/操作できる場所が分かりにくい」フィードバックを受け、既定でも
// 太枠を出す方針へ変更。カードの構造が一目で分かるようにする。クリック可能なカードは
// interactive でホバー強調、より強く囲みたい箱は elevated を使う。枠線を出したくない
// 表示専用ブロックは plain を明示指定する。
const cardVariants = cva(
	"bg-card text-card-foreground flex flex-col gap-6 border-border shadow-none rounded-none p-[24px]",
	{
		variants: {
			variant: {
				// 既定: 太枠で明確に囲む
				default: "border-thick",
				// クリック可能: 枠線あり + ホバーで強調
				interactive: "border-thick hover:border-primary hover:bg-muted/40 transition-colors cursor-pointer",
				// 明示的な囲み枠 (モーダル本体など)
				bordered: "border-thick",
				// 枠線なし (表示専用ブロックで明示的に外したいとき)
				plain: "",
				elevated: "border-heavy",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	}
);

interface CardProps
	extends React.ComponentProps<"div">,
		VariantProps<typeof cardVariants> {}

function Card({ className, variant, ...props }: CardProps) {
	return (
		<div
			data-slot="card"
			className={cn(cardVariants({ variant, className }))}
			{...props}
		/>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn(
				"@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
				className,
			)}
			{...props}
		/>
	);
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-title"
			className={cn("leading-none font-headline uppercase", className)}
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-description"
			className={cn("text-muted-foreground text-sm font-body", className)}
			{...props}
		/>
	);
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-action"
			className={cn(
				"col-start-2 row-span-2 row-start-1 self-start justify-self-end",
				className,
			)}
			{...props}
		/>
	);
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-content"
			className={cn(className)}
			{...props}
		/>
	);
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-footer"
			className={cn("flex items-center", className)}
			{...props}
		/>
	);
}

export {
	Card,
	CardHeader,
	CardFooter,
	CardTitle,
	CardAction,
	CardDescription,
	CardContent,
};
