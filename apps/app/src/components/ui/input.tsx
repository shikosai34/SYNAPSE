import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"flex w-full bg-input text-foreground border-border border-thick rounded-none px-[12px] py-[10px] font-mono text-[15px] transition-all outline-none",
				"placeholder:text-placeholder file:border-0 file:bg-transparent file:text-sm file:font-medium",
				"hover:bg-input-hover",
				"focus-visible:border-heavy focus-visible:ring-0",
				"aria-invalid:border-error aria-invalid:border-thick",
				"disabled:pointer-events-none disabled:border-border-disabled disabled:bg-input-disabled",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
