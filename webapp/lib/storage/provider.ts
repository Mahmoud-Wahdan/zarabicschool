import "server-only";

/**
 * StorageProvider abstracts private file storage (Supabase Storage in production).
 * Business logic never touches provider URLs or credentials directly — the same
 * pattern as MessagingProvider (INSTRUCTIONS.md §10). A test fake lives in
 * lib/storage/fake-storage.ts; the real implementation in lib/storage/supabase-storage.ts.
 */
export interface StorageUploadInput {
  path: string;
  buffer: Buffer;
  contentType: string;
}

export interface StorageProvider {
  upload(input: StorageUploadInput): Promise<void>;
  /** Short-lived signed URL for a private object. */
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
  /** Best-effort delete — used to compensate when a DB write fails after an upload. */
  remove(path: string): Promise<void>;
}
