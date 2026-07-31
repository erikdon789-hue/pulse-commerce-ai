import { requireUser } from "@/lib/pipeline/guard";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { getSupplierProvider } from "@/lib/suppliers/registry";
import type { SupplierId } from "@/lib/suppliers/types";

const VALID_SUPPLIERS: SupplierId[] = ["aliexpress", "alibaba", "cjdropshipping"];

export const GET = withRoute(
  async (_request: Request, { params }: { params: Promise<{ supplier: string; productId: string }> }) => {
    const guard = await requireUser();
    if (guard.error) return guard.error;

    const { supplier, productId } = await params;
    if (!VALID_SUPPLIERS.includes(supplier as SupplierId)) {
      return apiError("VALIDATION_ERROR", `supplier must be one of: ${VALID_SUPPLIERS.join(", ")}`, {
        status: 400,
      });
    }

    const provider = getSupplierProvider(supplier as SupplierId);
    if (!provider?.isConfigured()) {
      return apiError("SUPPLIER_NOT_CONFIGURED", `${supplier} is not configured`, { status: 400 });
    }

    const product = await provider.getProduct(productId);
    if (!product) {
      return apiError("PRODUCT_NOT_FOUND", "Product not found", { status: 404 });
    }

    return apiSuccess({ product });
  },
);
