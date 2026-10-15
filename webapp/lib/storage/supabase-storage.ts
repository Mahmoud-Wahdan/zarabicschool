import "server-only";

import type { StorageProvider, StorageUploadInput } from "./provider";

/**
 * Supabase Storage over plain REST (owner decision 2026-10-14: no SDK dependency).
 * Env names (values never logged): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * The bucket is PRIVATE; objects are only reachable through short-lived signed URLs.
 */
export const REPORT_ATTACHMENTS_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "report-attachments";

export class SupabaseStorageProvider implements StorageProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
    private readonly bucket: string = REPORT_ATTACHMENTS_BUCKET,
  ) {}

  async upload({ path, buffer, contentType }: StorageUploadInput): Promise<void> {
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${path}`, {
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
      throw new Error(`Storage upload failed with status ${response.status}.`);
    }
  }

  async createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const response = await fetch(`${this.baseUrl}/storage/v1/object/sign/${this.bucket}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!response.ok) {
      throw new Error(`Storage sign failed with status ${response.status}.`);
    }
    const payload = (await response.json().catch(() => null)) as { signedURL?: string } | null;
    if (!payload?.signedURL) {
      throw new Error("Storage sign returned no URL.");
    }
    return `${this.baseUrl}/storage/v1${payload.signedURL}`;
  }

  async remove(path: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.serviceKey}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Storage remove failed with status ${response.status}.`);
    }
  }
}
