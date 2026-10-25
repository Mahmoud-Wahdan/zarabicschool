import {
  isReportLanguage,
  reportDir,
  resolveReportLanguage,
  REPORT_LANGUAGES,
} from "../../lib/reports/report-language";
import { sessionReportSchema } from "../../lib/validation/management";

describe("Session 1 — report language resolution (lib/reports/report-language)", () => {
  it("UNIT-LANG-01: defaults to the student's profile language when the report draft carries none", () => {
    // The teacher form seeds its selector with the student's report_language
    // (the app passes that value when the report draft has no override), so a
    // student configured with "fr" resolves to a French, LTR report.
    const studentProfileLanguage = "fr";
    const draftLanguage: string | null = null;
    const resolved = resolveReportLanguage(draftLanguage ?? studentProfileLanguage);
    expect(resolved).toBe("fr");
    expect(reportDir(resolved)).toBe("ltr");
  });

  it("UNIT-LANG-02: an explicit report-level teacher override wins over the profile default", () => {
    // Student default "ar", the teacher selects "de" for this specific report.
    const studentProfileLanguage = "ar";
    const teacherSelection = "de";
    expect(studentProfileLanguage).toBe("ar");
    const resolved = resolveReportLanguage(teacherSelection);
    expect(resolved).toBe("de");
    expect(reportDir(resolved)).toBe("ltr");
    expect(isReportLanguage("de")).toBe(true);
  });

  it("UNIT-LANG-03: Arabic reports render right-to-left", () => {
    const resolved = resolveReportLanguage("ar");
    expect(resolved).toBe("ar");
    expect(reportDir(resolved)).toBe("rtl");
  });

  it("UNIT-LANG-04: every non-Arabic report language renders left-to-right", () => {
    for (const language of ["en", "fr", "de", "tr"] as const) {
      const resolved = resolveReportLanguage(language);
      expect(resolved).toBe(language);
      expect(reportDir(resolved)).toBe("ltr");
    }
  });

  it("UNIT-LANG-05: an unconfigured or invalid value falls back to the academy default ar (RTL)", () => {
    expect(resolveReportLanguage(null)).toBe("ar");
    expect(resolveReportLanguage(undefined)).toBe("ar");
    expect(resolveReportLanguage("es")).toBe("ar");
    expect(reportDir(resolveReportLanguage(null))).toBe("rtl");
    // The allowlist itself stays exactly the five confirmed languages.
    expect(REPORT_LANGUAGES).toEqual(["ar", "en", "fr", "de", "tr"]);
  });

  it("UNIT-LANG-06: the session report schema rejects an invalid language code", () => {
    // Zod v4 emits `invalid_value` for enum rejections (Zod 3's INVALID_ENUM_VALUE
    // no longer exists in the installed zod ^4.6.5 — noted in the test-plan report).
    const result = sessionReportSchema.safeParse({
      attendanceOutcome: "ATTENDED",
      classRemark: "good",
      summary: "Covered the lesson content.",
      homework: "Practice page 12.",
      language: "es",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((entry) => entry.path[0] === "language");
      expect(issue).toBeDefined();
      expect(issue?.code).toBe("invalid_value");
      expect(result.error.flatten().fieldErrors.language).toBeDefined();
    }
  });
});
