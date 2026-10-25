import "server-only";

/**
 * StorageProvider abstracts PRIVATE file storage (Cloudinary "authenticated"
 * assets since 2026-10-25; Supabase Storage remains only to read legacy rows).
 * Business logic never touches provider URLs or credentials directly — the same
 * pattern as MessagingProvider (INSTRUCTIONS.md §10). A test fake lives in
 * lib/storage/fake-storage.ts.
 *
 * The DB stores the object's identity (`key` = provider object id / Cloudinary
 * public_id, plus resource type and format) — NEVER a URL. Viewers get a
 * short-lived signed URL only after the server-side authorization check.
 */
export type StorageProviderName = "supabase" | "cloudinary";

export interface StorageUploadInput {
  /** Server-built folder (academy/session/report or academy/payment-proofs/invoice). Never user input. */
  folder: string;
  buffer: Buffer;
  /** Signature-detected MIME type (lib/storage/mime.ts), never the client's claim. */
  contentType: string;
  /** Signature-detected extension. */
  ext: string;
}

/** What the DB keeps to find an object again. */
export interface StoredObjectRef {
  key: string;
  resourceType: string | null;
  format: string | null;
}

export interface StoredObject extends StoredObjectRef {
  bytes: number;
}

export interface StorageProvider {
  readonly name: StorageProviderName;
  upload(input: StorageUploadInput): Promise<StoredObject>;
  /** Short-lived signed URL for a private object. */
  createSignedUrl(object: StoredObjectRef, expiresInSeconds: number): Promise<string>;
  /** Best-effort delete — used to compensate when a DB write fails after an upload. */
  remove(object: StoredObjectRef): Promise<void>;
}

/** Coded failure from a provider; messages never include provider response bodies. */
export class StorageError extends Error {
  constructor(
    readonly code: "STORAGE_NOT_CONFIGURED" | "UPLOAD_FAILED" | "SIGN_FAILED" | "REMOVE_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
