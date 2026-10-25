import "server-only";

import { prisma } from "../prisma";
import { CloudinaryStorageProvider } from "./cloudinary-storage";
import type { StorageProvider, StorageProviderName } from "./provider";
import { SupabaseStorageProvider } from "./supabase-storage";

let uploadProvider: StorageProvider | null = null;
let uploadResolved = false;
let legacyProvider: StorageProvider | null = null;
let legacyResolved = false;
let testOverride = false;

/**
 * The provider for NEW uploads (and for reading rows it wrote): Cloudinary since
 * 2026-10-25. Returns null when any CLOUDINARY_* value is missing — routes answer
 * with the coded STORAGE_NOT_CONFIGURED response instead of crashing.
 *
 * Env names (values only in .env, never in code/docs/logs, never sent to the browser):
 * - CLOUDINARY_CLOUD_NAME
 * - CLOUDINARY_API_KEY
 * - CLOUDINARY_API_SECRET (server-only)
 */
export function getStorageProvider(): StorageProvider | null {
  if (uploadResolved) return uploadProvider;
  uploadResolved = true;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    console.warn("[storage] CLOUDINARY_* is not fully configured — file uploads are disabled until the owner adds it.");
    return null;
  }
  uploadProvider = new CloudinaryStorageProvider(cloudName, apiKey, apiSecret);
  return uploadProvider;
}

/**
 * Supabase Storage — LEGACY reads only, for rows written before the Cloudinary
 * switch (`storage_provider = 'supabase'`). Env: SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET (optional).
 */
function getLegacySupabaseProvider(): StorageProvider | null {
  if (legacyResolved) return legacyProvider;
  legacyResolved = true;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  legacyProvider = url && key ? new SupabaseStorageProvider(url, key) : null;
  return legacyProvider;
}

/** The provider that holds an existing object, by the row's `storage_provider`. */
export function getStorageProviderFor(name: StorageProviderName): StorageProvider | null {
  if (testOverride) return uploadProvider;
  return name === "supabase" ? getLegacySupabaseProvider() : getStorageProvider();
}

/** Test-only: force a provider for every subsequent lookup (null = not configured). */
export function __setStorageProviderForTests(next: StorageProvider | null) {
  uploadProvider = next;
  uploadResolved = true;
  testOverride = next !== null;
}

let storageColumnsReady = false;
let warnedColumnsMissing = false;

/**
 * Migration 20261025000000_cloudinary_storage_columns (OWNER APPLIES) adds
 * `storage_provider`, `resource_type`, `format` to report_attachments and
 * payment_proofs. Until it lands, NEW uploads answer STORAGE_MIGRATION_PENDING
 * (they cannot record a Cloudinary object), while existing rows keep reading
 * through the legacy provider. Only the positive result is cached (self-healing).
 */
export async function isStorageColumnsReady(): Promise<boolean> {
  if (storageColumnsReady) return true;
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('report_attachments', 'payment_proofs') AND column_name = 'storage_provider'",
  )) as { count: number }[];
  storageColumnsReady = rows[0]?.count === 2;
  if (!storageColumnsReady && !warnedColumnsMissing) {
    warnedColumnsMissing = true;
    console.warn(
      "[storage] migration 20261025000000_cloudinary_storage_columns is not applied yet — uploads return STORAGE_MIGRATION_PENDING until the owner applies it.",
    );
  }
  return storageColumnsReady;
}
