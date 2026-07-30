import { cn } from "@/lib/utils";

function bandFor(score: number) {
  if (score >= 70) {
    return {
      label: "Strong",
      bar: "bg-emerald-500",
      text: "text-emerald-600 dark:text-emerald-400",
    };
  }
  if (score >= 40) {
    return {
      label: "Moderate",
      bar: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-400",
    };
  }
  return {
    label: "Weak",
    bar: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
  };
}

export function ViabilityScore({ score }: { score: number }) {
  const band = bandFor(score);
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={cn("text-3xl font-semibold", band.text)}>{score}</span>
        <span className="text-sm text-neutral-500">/ 100 · {band.label}</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div
          className={cn("h-full rounded-full transition-all", band.bar)}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
    </div>
  );
}
