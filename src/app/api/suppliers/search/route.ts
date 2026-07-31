import { requireUser } from "@/lib/pipeline/guard";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { listAllProviders } from "@/lib/suppliers/registry";
import type { SupplierId, SupplierSearchResult } from "@/lib/suppliers/types";

const VALID_SUPPLIERS: SupplierId[] = ["aliexpress", "alibaba", "cjdropshipping"];

// "Find Winning Products": fan out a keyword search across every configured
// supplier in parallel, and never let one supplier's failure (not
// configured, network error, unverified-API-shape error) hide the others'
// results — the caller gets back whatever succeeded plus a clear per-supplier
// error/skip breakdown instead of a single opaque 500.
export const GET = withRoute(async (request: Request) => {
  const guard = await requireUser();
  if (guard.error) return guard.error;

  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get("keyword")?.trim();
  if (!keyword) {
    return apiError("VALIDATION_ERROR", "keyword is required", { status: 400 });
  }

  const page = searchParams.get("page") ? Number(searchParams.get("page")) : undefined;
  const pageSize = searchParams.get("pageSize") ? Number(searchParams.get("pageSize")) : undefined;
  const minPrice = searchParams.get("minPrice") ? Number(searchParams.get("minPrice")) : undefined;
  const maxPrice = searchParams.get("maxPrice") ? Number(searchParams.get("maxPrice")) : undefined;

  const requestedSuppliers = searchParams.get("supplier")?.split(",").map((s) => s.trim());
  if (requestedSuppliers?.some((s) => !VALID_SUPPLIERS.includes(s as SupplierId))) {
    return apiError("VALIDATION_ERROR", `supplier must be one of: ${VALID_SUPPLIERS.join(", ")}`, {
      status: 400,
    });
  }

  const providers = listAllProviders().filter(
    (p) => !requestedSuppliers || requestedSuppliers.includes(p.id),
  );

  const skipped: SupplierId[] = [];
  const errors: Array<{ supplier: SupplierId; message: string }> = [];
  const results: SupplierSearchResult[] = [];

  await Promise.all(
    providers.map(async (provider) => {
      if (!provider.isConfigured()) {
        skipped.push(provider.id);
        return;
      }
      try {
        const result = await provider.search({ keyword, page, pageSize, minPrice, maxPrice });
        results.push(result);
      } catch (err) {
        errors.push({
          supplier: provider.id,
          message: err instanceof Error ? err.message : "Search failed",
        });
      }
    }),
  );

  return apiSuccess({ results, errors, skipped });
});
