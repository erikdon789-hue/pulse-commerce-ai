import type { SupplierId, SupplierProvider } from "./types";
import { createCjDropshippingProvider } from "./cjdropshipping";
import { createAliExpressProvider } from "./aliexpress";
import { createAlibabaProvider } from "./alibaba";

// Adding a new supplier (Amazon, Temu, 1688, DHgate, ...) means: write one
// provider module implementing SupplierProvider, add one line here. Nothing
// else in the app (search route, future scoring/import phases) needs to
// change.
const providers: Record<SupplierId, SupplierProvider> = {
  cjdropshipping: createCjDropshippingProvider(),
  aliexpress: createAliExpressProvider(),
  alibaba: createAlibabaProvider(),
};

export function getSupplierProvider(id: SupplierId): SupplierProvider | undefined {
  return providers[id];
}

export function listAllProviders(): SupplierProvider[] {
  return Object.values(providers);
}

export function listConfiguredProviders(): SupplierProvider[] {
  return listAllProviders().filter((p) => p.isConfigured());
}
