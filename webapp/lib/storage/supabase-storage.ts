import "server-only";

import { randomUUID } from "node:crypto";

import { StorageError, type StorageProvider, type StorageUploadInput, type StoredObject, type StoredObjectRef } from "./provider";

/**
 * Supabase Storage over plain REST (owner decision 2026-10-14: no SDK dependency).
 * LEGACY since 2026-10-25: new uploads go to Cloudinary; this provider only serves
 * rows whose `storage_provider = 'supabase'` (written before the switch). Nothing in
 * Supabase is migrated or deleted without the owner's OK.
 * Env names (values never logged): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * SUPABASE_STORAGE_BUCKET (optional). The bucket is PRIVATE; objects are only
 * reachable through short-lived signed URLs.
 */
export const REPORT_ATTACHMENTS_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "report-attachments";

export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
    private readonly bucket: string = REPORT_ATTACHMENTS_BUCKET,
  ) {}

  async upload({ folder, buffer, contentType, ext }: StorageUploadInput): Promise<StoredObject> {
    const key = `${folder}/${randomUUID()}.${ext}`;
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${key}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": contentType,
        "x-upsert": "false",
        "cache-control": "3600",
      },
      body: new Uint8Array(buffer),
    });
    if (!response.ok) {
      // Never include the response body — it can echo auth or path internals.
      throw new StorageError("UPLOAD_FAILED", `Storage upload failed with status ${response.status}.`);
    }
    return { key, resourceType: null, format: ext, bytes: buffer.length };
  }

  async createSignedUrl(object: StoredObjectRef, expiresInSeconds: number): Promise<string> {
    const response = await fetch(`${this.baseUrl}/storage/v1/object/sign/${this.bucket}/${object.key}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!response.ok) {
      throw new StorageError("SIGN_FAILED", `Storage sign failed with status ${response.status}.`);
    }
    const payload = (await response.json().catch(() => null)) as { signedURL?: string } | null;
    if (!payload?.signedURL) {
      throw new StorageError("SIGN_FAILED", "Storage sign returned no URL.");
    }
    return `${this.baseUrl}/storage/v1${payload.signedURL}`;
  }

  async remove(object: StoredObjectRef): Promise<void> {
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${object.key}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.serviceKey}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new StorageError("REMOVE_FAILED", `Storage remove failed with status ${response.status}.`);
    }
  }
}
