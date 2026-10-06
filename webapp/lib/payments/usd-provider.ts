import { PaymentProviderError, type PaymentProvider } from "./types";

export function createUsdProvider(): PaymentProvider {
  throw new PaymentProviderError(
    "USD payment provider is not configured yet. Choose a provider before enabling USD checkout.",
    "NOT_CONFIGURED",
    503,
  );
}
