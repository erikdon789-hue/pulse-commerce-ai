import { NextResponse } from "next/server";
import { requireStoreOwner } from "@/lib/pipeline/guard";
import { getStoreDetail } from "@/lib/pipeline/get-store-detail";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params;
  const guard = await requireStoreOwner(storeId);
  if (guard.error) return guard.error;

  const detail = await getStoreDetail(guard.supabase, guard.store);
  return NextResponse.json(detail);
}
