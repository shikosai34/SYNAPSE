import * as React from "react";

import { cn } from "@/lib/utils";

import { cva, type VariantProps } from "class-variance-authority";

// 2026-07-04: 「押せないものに枠線はいらない」方針へ。表示専用カードは枠線なしを既定にし、
// クリックできるカードだけ interactive で枠線＋ホバーを付ける。明示的に囲みたい箱 (モーダル等)
// は bordered を使う。区切り線 (border-b 等) は別途 className で付ける想定。
const cardVariants = cva(
	"bg-card text-card-foreground flex flex-col gap-6 border-border shadow-none rounded-none p-[24px]",
	{
		variants: {
			variant: {
				// 表示専用: 枠線なし
				default: "",
				// クリック可能: 枠線あり + ホバーで強調
				interactive: "border-thick hover:border-primary hover:bg-muted/40 transition-colors cursor-pointer",
				// 明示的な囲み枠 (モーダル本体など)
				bordered: "border-thick",
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
