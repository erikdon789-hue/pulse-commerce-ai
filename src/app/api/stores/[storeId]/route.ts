import { requireStoreOwner } from "@/lib/pipeline/guard";
import { getStoreDetail } from "@/lib/pipeline/get-store-detail";
import { apiSuccess, withRoute } from "@/lib/api/response";

export const GET = withRoute(
  async (_request: Request, { params }: { params: Promise<{ storeId: string }> }) => {
    const { storeId } = await params;
    const guard = await requireStoreOwner(storeId);
    if (guard.error) return guard.error;

    const detail = await getStoreDetail(guard.supabase, guard.store);
    return apiSuccess(detail);
  },
);
