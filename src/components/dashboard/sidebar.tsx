import Link from "next/link";
import { LayoutDashboard, Package, Receipt, Settings, Sparkles } from "lucide-react";

const links = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/products", label: "Products", icon: Package },
  { href: "/dashboard/orders", label: "Orders", icon: Receipt },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-neutral-200 p-4 sm:block dark:border-neutral-800">
      <Link href="/" className="mb-8 flex items-center gap-2 px-2 font-semibold">
        <Sparkles className="size-5 text-violet-600" />
        Pulse Commerce AI
      </Link>
      <nav className="flex flex-col gap-1">
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
    </aside>
  );
}
