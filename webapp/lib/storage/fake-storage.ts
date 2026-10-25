import { randomUUID } from "node:crypto";

import type { StorageProvider, StorageUploadInput, StoredObject, StoredObjectRef } from "./provider";

/**
 * In-memory fake for tests (MESSAGING_PROVIDER-style substitution). Stores bytes in
 * memory, never touches the network, and records every removal for compensation tests.
 * Reports itself as "cloudinary" so rows written in tests take the current code path.
 */
export class FakeStorageProvider implements StorageProvider {
  readonly name = "cloudinary" as const;
  readonly objects = new Map<string, { buffer: Buffer; contentType: string }>();
  readonly removedPaths: string[] = [];

  async upload({ folder, buffer, contentType, ext }: StorageUploadInput): Promise<StoredObject> {
    const key = `${folder}/${randomUUID()}`;
    this.objects.set(key, { buffer, contentType });
    return { key, resourceType: contentType.startsWith("audio/") ? "video" : "image", format: ext, bytes: buffer.length };
  }

  async createSignedUrl(object: StoredObjectRef): Promise<string> {
    if (!this.objects.has(object.key)) {
      throw new Error("Storage sign failed with status 404.");
    }
    return `https://fake-storage.test/signed/${encodeURIComponent(object.key)}`;
  }

  async remove(object: StoredObjectRef): Promise<void> {
    this.removedPaths.push(object.key);
    this.objects.delete(object.key);
  }

  reset() {
    this.objects.clear();
    this.removedPaths.length = 0;
  }
}

/**
 * Fake that fails the Nth upload — used to verify the request-atomic compensation
 * (no orphan DB rows, no orphan objects) without touching Prisma internals.
 */
export class FlakyStorageProvider extends FakeStorageProvider {
  private uploadCalls = 0;

  constructor(private readonly failOnUploadCall: number) {
    super();
  }

  async upload(input: StorageUploadInput): Promise<StoredObject> {
    this.uploadCalls += 1;
    if (this.uploadCalls === this.failOnUploadCall) {
      throw new Error("storage unavailable");
    }
    return super.upload(input);
  }
}
