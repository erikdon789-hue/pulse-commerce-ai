import { cn } from "@/lib/utils";
import type { Store } from "@/types";

const STATUS_CONFIG: Record<Store["status"], { label: string; className: string }> = {
  draft: {
    label: "Draft",
    className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  },
  building: {
    label: "Building…",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
  ready: {
    label: "Ready",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  connected: {
    label: "Connected to Shopify",
    className: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  },
  launched: {
    label: "Launched",
    className: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  },
};

export function StatusBadge({ status }: { status: Store["status"] }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        config.className,
      )}
    >
      {status === "building" && (
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {config.label}
    </span>
  );
}
