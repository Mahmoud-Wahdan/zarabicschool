import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { StorageError, type StorageProvider, type StorageUploadInput, type StoredObject, type StoredObjectRef } from "./provider";

const API_BASE = "https://api.cloudinary.com/v1_1";
const REQUEST_TIMEOUT_MS = 30_000;
/** Private delivery: assets need a signed request to be read (no public delivery URL). */
const DELIVERY_TYPE = "authenticated";

/**
 * Cloudinary over plain REST with server-side signatures (no SDK dependency, same
 * stance as the Supabase provider). Env names (values never logged or sent to the
 * browser): CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
 *
 * - Uploads are SIGNED and happen only from our server (no unsigned preset, the
 *   secret never leaves the server).
 * - Assets are uploaded as type "authenticated" with resource_type "auto"
 *   (images + PDF → image, audio → video). Cloudinary's public `secure_url` is
 *   ignored and never stored.
 * - Reads use the signed Download API URL with `expires_at` — short-lived, generated
 *   only after the caller passed the app's authorization check.
 */
export class CloudinaryStorageProvider implements StorageProvider {
  readonly name = "cloudinary" as const;

  constructor(
    private readonly cloudName: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  /** Cloudinary request signature: sha1 of the sorted `k=v&…` string + the API secret. */
  private sign(params: Record<string, string>): string {
    const payload = Object.keys(params)
      .filter((key) => params[key] !== "")
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");
    return createHash("sha1").update(payload + this.apiSecret).digest("hex");
  }

  private endpoint(resourceType: string, action: string) {
    return `${API_BASE}/${encodeURIComponent(this.cloudName)}/${resourceType}/${action}`;
  }

  async upload({ folder, buffer, contentType, ext }: StorageUploadInput): Promise<StoredObject> {
    const params: Record<string, string> = {
      overwrite: "false",
      public_id: `${folder}/${randomUUID()}`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: DELIVERY_TYPE,
    };
    const form = new FormData();
    for (const [key, value] of Object.entries(params)) form.append(key, value);
    form.append("api_key", this.apiKey);
    form.append("signature", this.sign(params));
    form.append("file", new Blob([new Uint8Array(buffer)], { type: contentType }), `upload.${ext}`);

    let response: Response;
    try {
      response = await fetch(this.endpoint("auto", "upload"), {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new StorageError("UPLOAD_FAILED", "Storage upload could not reach the provider.");
    }
    if (!response.ok) {
      // Never include the response body — it can echo request internals.
      throw new StorageError("UPLOAD_FAILED", `Storage upload failed with status ${response.status}.`);
    }
    const payload = (await response.json().catch(() => null)) as {
      public_id?: unknown;
      resource_type?: unknown;
      format?: unknown;
      bytes?: unknown;
      type?: unknown;
    } | null;
    if (!payload || typeof payload.public_id !== "string" || typeof payload.resource_type !== "string" || payload.type !== DELIVERY_TYPE) {
      throw new StorageError("UPLOAD_FAILED", "Storage upload returned an unexpected response.");
    }
    return {
      key: payload.public_id,
      resourceType: payload.resource_type,
      format: typeof payload.format === "string" ? payload.format : ext,
      bytes: typeof payload.bytes === "number" ? payload.bytes : buffer.length,
    };
  }

  async createSignedUrl(object: StoredObjectRef, expiresInSeconds: number): Promise<string> {
    if (!object.resourceType) throw new StorageError("SIGN_FAILED", "Stored object has no resource type.");
    const now = Math.floor(Date.now() / 1000);
    const params: Record<string, string> = {
      expires_at: String(now + Math.max(30, Math.min(expiresInSeconds, 3600))),
      format: object.format ?? "",
      public_id: object.key,
      timestamp: String(now),
      type: DELIVERY_TYPE,
    };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== "") query.set(key, value);
    query.set("api_key", this.apiKey);
    query.set("signature", this.sign(params));
    return `${this.endpoint(object.resourceType, "download")}?${query.toString()}`;
  }

  async remove(object: StoredObjectRef): Promise<void> {
    if (!object.resourceType) return;
    const params: Record<string, string> = {
      invalidate: "true",
      public_id: object.key,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: DELIVERY_TYPE,
    };
    const form = new FormData();
    for (const [key, value] of Object.entries(params)) form.append(key, value);
    form.append("api_key", this.apiKey);
    form.append("signature", this.sign(params));
    let response: Response;
    try {
      response = await fetch(this.endpoint(object.resourceType, "destroy"), {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new StorageError("REMOVE_FAILED", "Storage remove could not reach the provider.");
    }
    if (!response.ok && response.status !== 404) {
      throw new StorageError("REMOVE_FAILED", `Storage remove failed with status ${response.status}.`);
    }
  }
}
