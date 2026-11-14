import {
  DRIVE_LINK_MAX_LENGTH,
  driveLinkReasonMessages,
  validateDriveLink,
} from "../../lib/validation/drive-video";
import { applicationSchema } from "../../lib/validation/application";

/**
 * Owner task (2026-11-02): the teacher application requires an intro/explanation
 * video as a Google Drive link. Parse with `new URL()` — protocol exactly `https:`,
 * hostname exactly `drive.google.com` or `docs.google.com`, max 500 chars.
 * No includes()/weak regex. javascript:, data:, http: and everything else rejected.
 * The server never fetches or opens the link.
 */

function teacherPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "TEACHER",
    full_name: "Maryam Mahmoud",
    phone_whatsapp: "01012345678",
    email: "maryam@example.com",
    subjects: ["quran", "tajweed"],
    years_experience: 5,
    qualifications: "Ijazah in Hafs from Asim and 5 years online teaching",
    intro_video_url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
    ...overrides,
  };
}

describe("validateDriveLink — format only, never fetched", () => {
  it("accepts an https drive.google.com link", () => {
    expect(validateDriveLink("https://drive.google.com/file/d/1AbCdEfGh/view")).toEqual({ ok: true });
  });

  it("accepts an https docs.google.com link", () => {
    expect(validateDriveLink("https://docs.google.com/document/d/1AbCdEfGh/edit")).toEqual({ ok: true });
  });

  it("accepts exactly DRIVE_LINK_MAX_LENGTH characters", () => {
/    // prefix "https://drive.google.com/file/d/" = 32 chars, suffix "/view" = 5 chars → 37 fixed
    const filler = DRIVE_LINK_MAX_LENGTH - 37;
    const link = `https://drive.google.com/file/d/${"a".repeat(filler)}/view`;
    expect(link.length).toBe(DRIVE_LINK_MAX_LENGTH);
    expect(validateDriveLink(link)).toEqual({ ok: true });
  });

  it("rejects a link over DRIVE_LINK_MAX_LENGTH characters", () => {
    const filler = DRIVE_LINK_MAX_LENGTH - 36;
    const link = `https://drive.google.com/file/d/${"a".repeat(filler)}/view`;
    expect(link.length).toBe(DRIVE_LINK_MAX_LENGTH + 1);
    const result = validateDriveLink(link);
    expect(result).toEqual({ ok: false, reason: "DRIVE_LINK_TOO_LONG" });
    expect(driveLinkReasonMessages.DRIVE_LINK_TOO_LONG).toBeTruthy();
  });

  it("rejects lookalike hosts and other domains (hostname must be exact)", () => {
    expect(validateDriveLink("https://drive.usercontent.google.com/file/d/x/view")).toMatchObject({ ok: false, reason: "DRIVE_LINK_INVALID_HOST" });
    expect(validateDriveLink("https://googledrive.com/file/d/x/view")).toMatchObject({ ok: false, reason: "DRIVE_LINK_INVALID_HOST" });
    expect(validateDriveLink("https://evil.com/file/d/x/view")).toMatchObject({ ok: false, reason: "DRIVE_LINK_INVALID_HOST" });
    expect(validateDriveLink("https://drive.google.com.evil.com/file/d/x/view")).toMatchObject({ ok: false, reason: "DRIVE_LINK_INVALID_HOST" });
  });

  it("rejects http: (protocol must be exactly https:)", () => {
    expect(validateDriveLink("http://drive.google.com/file/d/x/view")).toEqual({ ok: false, reason: "DRIVE_LINK_NOT_HTTPS" });
  });

  it("rejects javascript: and data: URLs", () => {
    expect(validateDriveLink("javascript:alert(1)")).toEqual({ ok: false, reason: "DRIVE_LINK_NOT_HTTPS" });
    expect(validateDriveLink("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")).toEqual({ ok: false, reason: "DRIVE_LINK_NOT_HTTPS" });
  });

  it("rejects malformed URLs", () => {
    expect(validateDriveLink("https://drive.google.com:99999/x")).toMatchObject({ ok: false });
    expect(validateDriveLink("not a url at all")).toEqual({ ok: false, reason: "DRIVE_LINK_MALFORMED" });
  });

  it("rejects empty, whitespace-only, missing and non-string values", () => {
    expect(validateDriveLink("")).toEqual({ ok: false, reason: "DRIVE_LINK_REQUIRED" });
    expect(validateDriveLink("   ")).toEqual({ ok: false, reason: "DRIVE_LINK_REQUIRED" });
    expect(validateDriveLink(undefined)).toEqual({ ok: false, reason: "DRIVE_LINK_REQUIRED" });
    expect(validateDriveLink(null)).toEqual({ ok: false, reason: "DRIVE_LINK_REQUIRED" });
    expect(validateDriveLink(42)).toEqual({ ok: false, reason: "DRIVE_LINK_REQUIRED" });
    expect(validateDriveLink({ url: "https://drive.google.com/x" })).toEqual({ ok: false, reason: "DRIVE_LINK_REQUIRED" });
  });
});

describe("teacher application Zod — intro_video_url required (new submissions only)", () => {
  it("accepts a teacher application with a valid Drive link", () => {
    const parsed = applicationSchema.safeParse(teacherPayload());
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "TEACHER") {
      expect(parsed.data.intro_video_url).toBe("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view");
    }
  });

  it("rejects a teacher application without intro_video_url", () => {
    const { intro_video_url: _omitted, ...payload } = teacherPayload();
    const parsed = applicationSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
      expect(fieldErrors.intro_video_url).toBeDefined();
    }
  });

  it("rejects a teacher application with an empty intro_video_url", () => {
    const parsed = applicationSchema.safeParse(teacherPayload({ intro_video_url: "   " }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
      expect(fieldErrors.intro_video_url).toBeDefined();
    }
  });

  it("rejects a teacher application with a javascript: link", () => {
    const parsed = applicationSchema.safeParse(teacherPayload({ intro_video_url: "javascript:alert(1)" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
      expect(fieldErrors.intro_video_url).toBeDefined();
    }
  });

  it("rejects a teacher application with an http: link", () => {
    const parsed = applicationSchema.safeParse(teacherPayload({ intro_video_url: "http://drive.google.com/file/d/x/view" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
      expect(fieldErrors.intro_video_url).toBeDefined();
    }
  });

  it("rejects a teacher application with a lookalike-host link", () => {
    const parsed = applicationSchema.safeParse(teacherPayload({ intro_video_url: "https://drive.google.com.evil.com/file/d/x/view" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
      expect(fieldErrors.intro_video_url).toBeDefined();
    }
  });

  it("rejects a teacher application with an over-length link", () => {
    const parsed = applicationSchema.safeParse(teacherPayload({ intro_video_url: `https://drive.google.com/file/d/${"a".repeat(600)}/view` }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
      expect(fieldErrors.intro_video_url).toBeDefined();
    }
  });

  it("does not require intro_video_url for guardian and student applications", () => {
    const guardian = applicationSchema.safeParse({
      type: "GUARDIAN",
      full_name: "Fatima Ahmed",
      phone_whatsapp: "01012345678",
      children: [{ name: "Omar", age: 10, subjects: ["quran"] }],
    });
    expect(guardian.success).toBe(true);

    const student = applicationSchema.safeParse({
      type: "STUDENT",
      full_name: "Youssef Ibrahim",
      phone_whatsapp: "+201123456789",
      date_of_birth: "1995-05-15",
      subjects: ["quran"],
      level: "intermediate",
    });
    expect(student.success).toBe(true);
  });
});
