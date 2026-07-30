import { Card } from "@/components/ui/card";

export default function OrdersPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Orders</h1>
      <Card className="mt-6 text-sm text-neutral-600 dark:text-neutral-300">
        Orders will appear here once the Stripe webhook
        (<code>src/app/api/webhooks/stripe/route.ts</code>) starts writing
        paid checkout sessions into the <code>orders</code> table.
      </Card>
    </div>
  );
}
