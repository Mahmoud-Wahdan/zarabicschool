import {
  applicationSchema,
  createApplicationSchema,
  normalizeApplication,
  validateApplicationSubjects,
  calculateAge,
} from "../../lib/validation/application";
import { POST } from "../../app/api/applications/route";
import { disconnectPrisma, prisma } from "../../lib/prisma";
import { resetRateLimits } from "../../lib/rate-limit";

describe("Slice C1 — Application Validation & Submission", () => {
  const testPhone = "+201099999999";
  const rawTestPhone = "01099999999";

  afterEach(async () => {
    resetRateLimits();
    // Clean up any demo_test_* applications created during integration tests
    try {
      await prisma.application.deleteMany({
        where: { contactPhone: testPhone },
      });
    } catch {
      // Ignored if DB is not reachable in offline unit test runs
    }
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  describe("Zod Unit Tests Per Type", () => {
    it("validates a valid Guardian application (uppercase & lowercase type)", () => {
      const payloadUpper = {
        type: "GUARDIAN",
        full_name: "Fatima Ahmed",
        phone_whatsapp: "01012345678",
        email: "fatima@example.com",
        timezone: "Africa/Cairo",
        preferred_language: "ar",
        children: [
          {
            name: "Omar",
            age: 10,
            subjects: ["quran", "arabic"],
          },
        ],
        preferred_times: "Evenings",
        notes: "Looking forward to starting",
      };

      const parsedUpper = applicationSchema.safeParse(payloadUpper);
      expect(parsedUpper.success).toBe(true);

      const payloadLower = { ...payloadUpper, type: "guardian" };
      const parsedLower = applicationSchema.safeParse(payloadLower);
      expect(parsedLower.success).toBe(true);

      if (parsedLower.success) {
        const normalized = normalizeApplication(parsedLower.data);
        expect(normalized.type).toBe("GUARDIAN");
        expect(normalized.phone_whatsapp).toBe("+201012345678");
      }
    });

    it("rejects guardian application without children", () => {
      const payload = {
        type: "GUARDIAN",
        full_name: "Fatima Ahmed",
        phone_whatsapp: "01012345678",
        children: [],
      };
      const parsed = applicationSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
    });

    it("validates a valid adult Student application", () => {
      const payload = {
        type: "STUDENT",
        full_name: "Youssef Ibrahim",
        phone_whatsapp: "+201123456789",
        date_of_birth: "1995-05-15",
        subjects: ["quran"],
        level: "intermediate",
      };

      const parsed = applicationSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const normalized = normalizeApplication(parsed.data);
        expect(normalized.type).toBe("STUDENT");
      }
    });

    it("validates a valid Teacher application (without expected_hourly_rate or currency)", () => {
      const payload = {
        type: "TEACHER",
        full_name: "Maryam Mahmoud",
        phone_whatsapp: "01234567890",
        email: "maryam@example.com",
        subjects: ["quran", "tajweed"],
        years_experience: 5,
        qualifications: "Ijazah in Hafs from Asim and 5 years online teaching",
        available_times: "Weekday mornings",
      };

      const parsed = applicationSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const normalized = normalizeApplication(parsed.data);
        expect(normalized.type).toBe("TEACHER");
        // Verify hourly rate and currency are not expected on the object
        expect("expected_hourly_rate" in normalized).toBe(false);
        expect("currency" in normalized).toBe(false);
      }
    });
  });

  describe("Under-18 Minor Student Validation", () => {
    it("computes age correctly server-side", () => {
      const relative = new Date("2026-10-04T00:00:00Z");
      expect(calculateAge("2010-10-03", relative)).toBe(16);
      expect(calculateAge("2010-10-05", relative)).toBe(15);
      expect(calculateAge("2008-10-04", relative)).toBe(18);
      expect(calculateAge("2008-10-05", relative)).toBe(17);
    });

    it("rejects under-18 student without guardian fields", () => {
      const payload = {
        type: "STUDENT",
        full_name: "Zaid Ali",
        phone_whatsapp: "01012345678",
        date_of_birth: "2012-03-20", // Under 18
        subjects: ["arabic"],
        level: "beginner",
      };

      const parsed = applicationSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
        expect(fieldErrors.guardian_name).toBeDefined();
        expect(fieldErrors.guardian_phone).toBeDefined();
        expect(fieldErrors.guardian_relationship).toBeDefined();
      }
    });

    it("accepts under-18 student when all guardian fields are provided", () => {
      const payload = {
        type: "STUDENT",
        full_name: "Zaid Ali",
        phone_whatsapp: "01012345678",
        date_of_birth: "2012-03-20",
        subjects: ["arabic"],
        level: "beginner",
        guardian_name: "Ali Mahmoud",
        guardian_phone: "01098765432",
        guardian_relationship: "father",
      };

      const parsed = applicationSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const normalized = normalizeApplication(parsed.data);
        if (normalized.type === "STUDENT") {
          expect(normalized.guardian_phone).toBe("+201098765432");
        }
      }
    });
  });

  describe("Subject Validation Against Active DB Subjects", () => {
    const allowed = ["quran", "arabic", "islamic-studies"];

    it("rejects unknown subjects via createApplicationSchema", () => {
      const schema = createApplicationSchema(allowed);
      const invalid = {
        type: "STUDENT",
        full_name: "Ali Omar",
        phone_whatsapp: "01012345678",
        date_of_birth: "1999-01-01",
        subjects: ["quantum-physics"], // unknown
        level: "beginner",
      };

      const parsed = schema.safeParse(invalid);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
        expect(fieldErrors.subjects).toBeDefined();
      }
    });

    it("rejects unknown subjects via validateApplicationSubjects helper", () => {
      const payload = {
        type: "GUARDIAN" as const,
        full_name: "Nour Hasan",
        phone_whatsapp: "01012345678",
        timezone: "Africa/Cairo",
        preferred_language: "ar" as const,
        children: [
          { name: "Salma", age: 8, subjects: ["quran", "robotics"] },
        ],
      };

      const result = validateApplicationSubjects(payload, allowed);
      expect(result.valid).toBe(false);
      expect(result.unknownSubjects).toContain("robotics");
      expect(result.fieldErrors?.["children.0.subjects"]).toBeDefined();
    });

    it("accepts valid active subjects", () => {
      const payload = {
        type: "STUDENT" as const,
        full_name: "Ali Omar",
        phone_whatsapp: "01012345678",
        date_of_birth: "1999-01-01",
        subjects: ["quran", "arabic"],
        level: "beginner" as const,
        timezone: "Africa/Cairo",
        preferred_language: "ar" as const,
      };

      const result = validateApplicationSubjects(payload, allowed);
      expect(result.valid).toBe(true);
      expect(result.unknownSubjects.length).toBe(0);
    });
  });

  describe("Honeypot, Rate Limiting & 24h Duplicate Check", () => {
    it("handles honeypot silently with fake success and no database row", async () => {
      const honeypotPayload = {
        type: "STUDENT",
        full_name: "Spam Bot",
        phone_whatsapp: rawTestPhone,
        date_of_birth: "1990-01-01",
        subjects: ["quran"],
        level: "beginner",
        honeypot: "i-am-a-bot",
      };

      const req = new Request("http://localhost:3000/api/applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "192.168.1.100",
        },
        body: JSON.stringify(honeypotPayload),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBeDefined();

      // Ensure no database row was created
      const dbRow = await prisma.application.findFirst({
        where: { contactPhone: testPhone },
      });
      expect(dbRow).toBeNull();
    });

    it("enforces per-IP rate limiting after 5 requests", async () => {
      const ip = "192.168.200.50";
      const payload = {
        type: "STUDENT",
        full_name: "Rate Test",
        phone_whatsapp: rawTestPhone,
        date_of_birth: "1990-01-01",
        subjects: ["quran"],
        level: "beginner",
        honeypot: "fast-bot", // Use honeypot to avoid DB writes during rate limit test
      };

      // 5 allowed requests
      for (let i = 0; i < 5; i++) {
        const req = new Request("http://localhost:3000/api/applications", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": ip,
          },
          body: JSON.stringify(payload),
        });
        const res = await POST(req);
        expect(res.status).toBe(201);
      }

      // 6th request must be rate limited (429)
      const blockedReq = new Request("http://localhost:3000/api/applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify(payload),
      });
      const blockedRes = await POST(blockedReq);
      expect(blockedRes.status).toBe(429);
      const blockedData = await blockedRes.json();
      expect(blockedData.error.code).toBe("RATE_LIMITED");
    });
  });
});
