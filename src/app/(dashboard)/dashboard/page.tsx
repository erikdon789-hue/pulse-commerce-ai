import { Card } from "@/components/ui/card";

const stats = [
  { label: "Revenue (30d)", value: "$0.00" },
  { label: "Orders", value: "0" },
  { label: "Products", value: "0" },
  { label: "AI recommendations served", value: "0" },
];

export default function DashboardOverviewPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Overview</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
        Connect Supabase and Stripe to see live data here.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <p className="text-sm text-neutral-500">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold">{stat.value}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
