import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStoreDetail } from "@/lib/pipeline/get-store-detail";
import { StoreBuilder } from "@/components/dashboard/store-builder";

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) notFound();

  const { data: store } = await supabase
    .from("stores")
    .select("*")
    .eq("id", storeId)
    .eq("owner_id", user.id)
    .single();

  if (!store) notFound();

  const detail = await getStoreDetail(supabase, store);

  return <StoreBuilder initial={detail} />;
}
