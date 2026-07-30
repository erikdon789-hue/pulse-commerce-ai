import { Card } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card className="mt-6 text-sm text-neutral-600 dark:text-neutral-300">
        Account, billing, and API key management will live here. Wire this up
        to the <code>profiles</code> table and Stripe customer portal once
        auth is in place.
      </Card>
    </div>
  );
}
