import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const cardClassName =
  "rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(cardClassName, className)} {...props} />;
}
