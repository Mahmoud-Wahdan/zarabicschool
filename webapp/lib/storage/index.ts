import "server-only";

import type { StorageProvider } from "./provider";
import { SupabaseStorageProvider } from "./supabase-storage";

let provider: StorageProvider | null = null;
let providerResolved = false;

/**
 * Resolves the StorageProvider from env at call time (OpenWA pattern). Returns null
 * when Supabase Storage is not configured — attachment routes answer with a clean
 * "not configured" response instead of failing.
 *
 * Env names (values only in .env, never in code/docs/logs):
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY (server-only; never exposed to the client)
 * - SUPABASE_STORAGE_BUCKET (optional, default "report-attachments")
 */
export function getStorageProvider(): StorageProvider | null {
  if (providerResolved) return provider;
  providerResolved = true;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn(
      "[storage] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured — report attachments are disabled until the owner adds them.",
    );
    return null;
  }
  provider = new SupabaseStorageProvider(url, key);
  return provider;
}

/** Test-only: force a provider for the next getStorageProvider() call. */
export function __setStorageProviderForTests(next: StorageProvider | null) {
  provider = next;
  providerResolved = true;
}
