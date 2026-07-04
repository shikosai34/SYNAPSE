import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center uppercase tracking-[1px] border-thin rounded-none focus:outline-none focus:ring-0",
  {
    variants: {
      variant: {
        filter: "bg-background text-foreground border-border text-[10px] px-[12px] py-[4px] hover:bg-primary hover:text-primary-foreground active:bg-primary active:text-primary-foreground",
        default: "bg-background text-foreground border-border text-[11px] font-semibold px-[10px] py-[2px]",
        active: "bg-background text-success border-success text-[11px] font-semibold px-[10px] py-[2px]",
        warning: "bg-background text-warning border-warning text-[11px] font-semibold px-[10px] py-[2px]",
        error: "bg-background text-error border-error text-[11px] font-semibold px-[10px] py-[2px]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
