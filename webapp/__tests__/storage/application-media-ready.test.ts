import {
  isApplicationMediaReady,
  __setApplicationMediaReadyForTests,
} from "../../lib/storage/application-media-ready";
import { prisma } from "../../lib/prisma";

describe("isApplicationMediaReady helper", () => {
  beforeEach(() => {
    __setApplicationMediaReadyForTests(null);
  });

  afterEach(() => {
    __setApplicationMediaReadyForTests(null);
    jest.restoreAllMocks();
  });

  it("returns true when information_schema reports intro_video_url column exists", async () => {
    jest.spyOn(prisma, "$queryRawUnsafe").mockResolvedValueOnce([{ count: 1 }]);
    const ready = await isApplicationMediaReady();
    expect(ready).toBe(true);
  });

  it("caches the positive result so repeated calls do not query the database again", async () => {
    const spy = jest.spyOn(prisma, "$queryRawUnsafe").mockResolvedValueOnce([{ count: 1 }]);
    const first = await isApplicationMediaReady();
    const second = await isApplicationMediaReady();
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns false when the column is not yet present and does not cache negative result", async () => {
    const spy = jest.spyOn(prisma, "$queryRawUnsafe")
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 1 }]);

    const first = await isApplicationMediaReady();
    expect(first).toBe(false);

    // Re-check after migration lands returns true
    const second = await isApplicationMediaReady();
    expect(second).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("allows test override via __setApplicationMediaReadyForTests", async () => {
    __setApplicationMediaReadyForTests(false);
    expect(await isApplicationMediaReady()).toBe(false);

    __setApplicationMediaReadyForTests(true);
    expect(await isApplicationMediaReady()).toBe(true);
  });
});
