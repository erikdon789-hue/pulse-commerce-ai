import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Navbar() {
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-5 text-violet-600" />
          Pulse Commerce AI
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium text-neutral-600 sm:flex dark:text-neutral-300">
          <Link href="/pricing">Pricing</Link>
          <Link href="/dashboard">Dashboard</Link>
        </nav>
        <Link href="/dashboard/new">
          <Button size="sm">Get started</Button>
        </Link>
      </div>
    </header>
  );
}
