import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { CreditPlans } from "@/components/dashboard/credit-plans";

async function getCreditsBalance(): Promise<number | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from("profiles")
      .select("credits_balance")
      .eq("id", user.id)
      .single();

    return data?.credits_balance ?? 0;
  } catch {
    return null;
  }
}

export default async function BillingPage() {
  const balance = await getCreditsBalance();

  return (
    <div>
      <h1 className="text-2xl font-semibold">Billing</h1>

      <Card className="mt-6">
        <p className="text-sm text-neutral-500">Credits remaining</p>
        <p className="mt-2 text-3xl font-semibold">{balance ?? "—"}</p>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          Each full store build (analysis through marketing content) uses 1 credit.
        </p>
      </Card>

      <div className="mt-6">
        <CreditPlans />
      </div>
    </div>
  );
}
