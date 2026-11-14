jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

import { getServerSession } from "next-auth";
import { GET } from "../../app/api/applications/[id]/media/route";
import { prisma, disconnectPrisma } from "../../lib/prisma";
import { __setStorageProviderForTests } from "../../lib/storage";
import { FakeStorageProvider } from "../../lib/storage/fake-storage";

const getServerSessionMock = getServerSession as jest.Mock;

describe("GET /api/applications/[id]/media — Staff-only signed audio URL", () => {
  const academyId = "11111111-1111-1111-1111-111111111111";
  const adminUserId = "admin-user-uuid-1234";
  const studentUserId = "student-user-uuid-5678";
  let fakeStorage: FakeStorageProvider;

  beforeEach(() => {
    fakeStorage = new FakeStorageProvider();
    __setStorageProviderForTests(fakeStorage);

    // Mock session default to Admin
    getServerSessionMock.mockResolvedValue({
      user: { id: adminUserId, email: "admin@example.com" },
    });

    // Mock user lookup in requireApiRoles
    jest.spyOn(prisma.user, "findUnique").mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === adminUserId) {
        return Promise.resolve({
          id: adminUserId,
          academyId,
          role: "ADMIN",
          isActive: true,
          mustChangePassword: false,
        } as never);
      }
      if (where.id === studentUserId) {
        return Promise.resolve({
          id: studentUserId,
          academyId,
          role: "STUDENT",
          isActive: true,
          mustChangePassword: false,
        } as never);
      }
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    __setStorageProviderForTests(null);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("rejects unauthenticated requests with 401", async () => {
    getServerSessionMock.mockResolvedValueOnce(null);

    const req = new Request("http://localhost:3000/api/applications/app-1/media");
    const res = await GET(req, { params: Promise.resolve({ id: "app-1" }) });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin roles (e.g. STUDENT) with 403", async () => {
    getServerSessionMock.mockResolvedValueOnce({
      user: { id: studentUserId, email: "student@example.com" },
    });

    const req = new Request("http://localhost:3000/api/applications/app-1/media");
    const res = await GET(req, { params: Promise.resolve({ id: "app-1" }) });
    expect(res.status).toBe(403);
  });

  it("returns 404 when application is not found", async () => {
    jest.spyOn(prisma.application, "findFirst").mockResolvedValueOnce(null);

    const req = new Request("http://localhost:3000/api/applications/not-found/media");
    const res = await GET(req, { params: Promise.resolve({ id: "not-found" }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 when application has no recitation audio", async () => {
    jest.spyOn(prisma.application, "findFirst").mockResolvedValueOnce({
      id: "app-no-audio",
      academyId,
      recitationAudioPath: null,
      recitationAudioStorageProvider: null,
      recitationAudioResourceType: null,
      recitationAudioFormat: null,
    } as never);

    const req = new Request("http://localhost:3000/api/applications/app-no-audio/media");
    const res = await GET(req, { params: Promise.resolve({ id: "app-no-audio" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error?.code).toBe("AUDIO_NOT_FOUND");
  });

  it("returns signed URL with 900s expiry for ADMIN", async () => {
    const audioKey = "academy-1/applications/recitations/audio-uuid-123";
    fakeStorage.objects.set(audioKey, {
      buffer: Buffer.from("audio"),
      contentType: "audio/mpeg",
    });

    jest.spyOn(prisma.application, "findFirst").mockResolvedValueOnce({
      id: "app-with-audio",
      academyId,
      recitationAudioPath: audioKey,
      recitationAudioStorageProvider: "cloudinary",
      recitationAudioResourceType: "video",
      recitationAudioFormat: "mp3",
    } as never);

    const req = new Request("http://localhost:3000/api/applications/app-with-audio/media");
    const res = await GET(req, { params: Promise.resolve({ id: "app-with-audio" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.url).toBeTruthy();
    expect(body.expiresIn).toBe(900);
    // Never leak storage path/public_id in response
    expect(body.recitationAudioPath).toBeUndefined();
    expect(body.key).toBeUndefined();
  });
});
