import { POST } from "../../app/api/applications/route";
import { prisma, disconnectPrisma } from "../../lib/prisma";
import { resetRateLimits } from "../../lib/rate-limit";
import { __setStorageProviderForTests } from "../../lib/storage";
import { FakeStorageProvider } from "../../lib/storage/fake-storage";
import { __setApplicationMediaReadyForTests } from "../../lib/storage/application-media-ready";
import { sameOriginHeaders } from "../helpers/http";

describe("POST /api/applications — Teacher media (video link & recitation audio)", () => {
  const rawTestPhone = "01088888888";
  let fakeStorage: FakeStorageProvider;

  beforeEach(() => {
    resetRateLimits();
    fakeStorage = new FakeStorageProvider();
    __setStorageProviderForTests(fakeStorage);
    __setApplicationMediaReadyForTests(true);

    // Default mocks for external lookups so tests run reliably offline/online
    jest.spyOn(prisma.academy, "findUnique").mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Zarabicschool",
    } as never);

    jest.spyOn(prisma.subject, "findMany").mockResolvedValue([
      { id: "22222222-2222-2222-2222-222222222222", slug: "quran" },
      { id: "33333333-3333-3333-3333-333333333333", slug: "tajweed" },
    ] as never);

    jest.spyOn(prisma.application, "findFirst").mockResolvedValue(null);
  });

  afterEach(() => {
    __setApplicationMediaReadyForTests(null);
    __setStorageProviderForTests(null);
    resetRateLimits();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  function mp3Bytes(): Buffer {
    // Valid ID3v2 header magic bytes + filler
    return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20]), Buffer.alloc(64, 1)]);
  }

  function teacherPayload(overrides: Record<string, unknown> = {}) {
    return {
      type: "TEACHER",
      full_name: "Aisha Mansour",
      phone_whatsapp: rawTestPhone,
      email: "aisha@example.com",
      subjects: ["quran"],
      years_experience: 7,
      qualifications: "Ten Qira'at certified with 7 years teaching",
      intro_video_url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
      ...overrides,
    };
  }

  it("submits teacher application with valid video link and recitation audio via multipart", async () => {
    const audioBytes = mp3Bytes();
    const createSpy = jest.spyOn(prisma.application, "create").mockResolvedValueOnce({
      id: "mock-app-id-1234",
    } as never);

    const form = new FormData();
    form.append("data", JSON.stringify(teacherPayload()));
    form.append("recitation_audio", new File([new Uint8Array(audioBytes)], "recitation.mp3", { type: "audio/mpeg" }));

    const req = new Request("http://localhost:3000/api/applications", {
      method: "POST",
      headers: sameOriginHeaders({ "x-forwarded-for": "10.0.0.1" }),
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("mock-app-id-1234");

    // Verify storage received upload
    expect(fakeStorage.objects.size).toBe(1);

    // Verify DB insert payload contains video and audio identity
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          introVideoUrl: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
          recitationAudioStorageProvider: "cloudinary",
          recitationAudioResourceType: "video",
          recitationAudioFormat: "mp3",
          recitationAudioSizeBytes: BigInt(audioBytes.length),
        }),
      })
    );
  });

  it("submits teacher application without recitation audio (audio is optional)", async () => {
    const createSpy = jest.spyOn(prisma.application, "create").mockResolvedValueOnce({
      id: "mock-app-id-no-audio",
    } as never);

    const form = new FormData();
    form.append("data", JSON.stringify(teacherPayload()));

    const req = new Request("http://localhost:3000/api/applications", {
      method: "POST",
      headers: sameOriginHeaders({ "x-forwarded-for": "10.0.0.2" }),
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(fakeStorage.objects.size).toBe(0);

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          introVideoUrl: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
          recitationAudioPath: null,
          recitationAudioStorageProvider: null,
          recitationAudioResourceType: null,
          recitationAudioFormat: null,
          recitationAudioSizeBytes: null,
        }),
      })
    );
  });

  it("rejects teacher application when audio has invalid magic bytes", async () => {
    const form = new FormData();
    form.append("data", JSON.stringify(teacherPayload()));
    // Plain text masquerading as mp3
    const fakeBytes = Buffer.from("NOT AN AUDIO FILE");
    form.append("recitation_audio", new File([new Uint8Array(fakeBytes)], "recitation.mp3", { type: "audio/mpeg" }));

    const req = new Request("http://localhost:3000/api/applications", {
      method: "POST",
      headers: sameOriginHeaders({ "x-forwarded-for": "10.0.0.3" }),
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe("INVALID_AUDIO_TYPE");
    expect(fakeStorage.objects.size).toBe(0);
  });

  it("rejects teacher application when audio exceeds 10 MB limit", async () => {
    const form = new FormData();
    form.append("data", JSON.stringify(teacherPayload()));
    // Valid magic bytes header + filler totaling > 10 MB (10 MB + 100 bytes)
    const largeBytes = Buffer.concat([
      Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20]),
      Buffer.alloc(10 * 1024 * 1024 + 100),
    ]);
    form.append("recitation_audio", new File([new Uint8Array(largeBytes)], "large.mp3", { type: "audio/mpeg" }));

    const req = new Request("http://localhost:3000/api/applications", {
      method: "POST",
      headers: sameOriginHeaders({ "x-forwarded-for": "10.0.0.4" }),
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error?.code).toBe("AUDIO_TOO_LARGE");
    expect(fakeStorage.objects.size).toBe(0);
  });

  it("returns 409 APPLICATION_MEDIA_MIGRATION_PENDING when migration is not ready", async () => {
    __setApplicationMediaReadyForTests(false);

    const form = new FormData();
    form.append("data", JSON.stringify(teacherPayload()));

    const req = new Request("http://localhost:3000/api/applications", {
      method: "POST",
      headers: sameOriginHeaders({ "x-forwarded-for": "10.0.0.5" }),
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error?.code).toBe("APPLICATION_MEDIA_MIGRATION_PENDING");
  });

  it("compensates by removing uploaded audio if DB insert fails", async () => {
    const form = new FormData();
    form.append("data", JSON.stringify(teacherPayload()));
    form.append("recitation_audio", new File([new Uint8Array(mp3Bytes())], "recitation.mp3", { type: "audio/mpeg" }));

    // Mock prisma.application.create to fail
    jest.spyOn(prisma.application, "create").mockRejectedValueOnce(new Error("DB failure"));

    const req = new Request("http://localhost:3000/api/applications", {
      method: "POST",
      headers: sameOriginHeaders({ "x-forwarded-for": "10.0.0.6" }),
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error?.code).toBe("SUBMISSION_FAILED");

    // Compensation check: uploaded file must have been deleted from storage
    expect(fakeStorage.removedPaths.length).toBe(1);
  });
});
