import Link from "next/link";
import { LayoutDashboard, PlusCircle, CreditCard, Sparkles } from "lucide-react";
import { SignOutButton } from "@/components/dashboard/sign-out-button";

const links = [
  { href: "/dashboard", label: "My Stores", icon: LayoutDashboard },
  { href: "/dashboard/new", label: "New Store", icon: PlusCircle },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-neutral-200 p-4 sm:flex dark:border-neutral-800">
      <Link href="/" className="mb-8 flex items-center gap-2 px-2 font-semibold">
        <Sparkles className="size-5 text-violet-600" />
        Pulse Commerce AI
      </Link>
      <nav className="flex flex-1 flex-col gap-1">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
      <SignOutButton />
    </aside>
  );
}
