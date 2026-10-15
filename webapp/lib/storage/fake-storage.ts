import type { StorageProvider, StorageUploadInput } from "./provider";

/**
 * In-memory fake for tests (MESSAGING_PROVIDER-style substitution). Stores bytes in
 * memory, never touches the network, and records every removal for compensation tests.
 */
export class FakeStorageProvider implements StorageProvider {
  readonly objects = new Map<string, { buffer: Buffer; contentType: string }>();
  readonly removedPaths: string[] = [];

  async upload({ path, buffer, contentType }: StorageUploadInput): Promise<void> {
    this.objects.set(path, { buffer, contentType });
  }

  async createSignedUrl(path: string): Promise<string> {
    if (!this.objects.has(path)) {
      throw new Error("Storage sign failed with status 404.");
    }
    return `https://fake-storage.test/signed/${encodeURIComponent(path)}`;
  }

  async remove(path: string): Promise<void> {
    this.removedPaths.push(path);
    this.objects.delete(path);
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

  async upload(input: { path: string; buffer: Buffer; contentType: string }): Promise<void> {
    this.uploadCalls += 1;
    if (this.uploadCalls === this.failOnUploadCall) {
      throw new Error("storage unavailable");
    }
    await super.upload(input);
  }
}
