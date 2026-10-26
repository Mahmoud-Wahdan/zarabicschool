/**
 * Messaging provider mode (owner, 2026-10-27). MESSAGING_PROVIDER=console is a
 * development aid only; "fake" exists only inside the Jest suite. A production
 * process configured with either must REFUSE TO START (instrumentation.ts calls
 * this before anything else) — a misconfigured host must never silently drop or
 * print real WhatsApp messages.
 */
const NON_PRODUCTION_PROVIDERS = ["console", "fake"];

export function assertMessagingProviderAllowed(env: Record<string, string | undefined> = process.env): void {
  const provider = env.MESSAGING_PROVIDER?.trim().toLowerCase();
  if (env.NODE_ENV === "production" && provider && NON_PRODUCTION_PROVIDERS.includes(provider)) {
    throw new Error(`MESSAGING_PROVIDER=${provider} is not allowed in production. Remove it (production always uses OpenWA).`);
  }
}
