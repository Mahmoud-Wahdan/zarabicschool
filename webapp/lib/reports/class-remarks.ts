import "server-only";

import { prisma } from "../prisma";
import type { ReportLanguageCode } from "./report-language";

export { classRemarkLabel } from "./report-language";
import type { ClassRemarkOptionLike } from "./report-language";

export const CLASS_REMARKS_SETTING_KEY = "report.class_remarks";

/**
 * Class-remark options (owner, 2026-10-18): an Admin-managed list in
 * AcademySettings where EVERY option carries a label per report language
 * (ar/en/fr/de/tr — CONTEXT §9). `slug` is what gets stored on
 * `reports.class_remark`; viewers resolve the slug to the label in the
 * report's language (lib/reports/report-language.ts — client-safe).
 */
export type ClassRemarkOption = ClassRemarkOptionLike;

/** Seeded list (owner, 2026-10-18): Excellent / Very Good / Good / Acceptable / Needs Improvement. */
export const DEFAULT_CLASS_REMARK_OPTIONS: ClassRemarkOption[] = [
  {
    slug: "excellent",
    labels: { ar: "ممتاز", en: "Excellent", fr: "Excellent", de: "Hervorragend", tr: "Mükemmel" },
  },
  {
    slug: "very_good",
    labels: { ar: "جيد جدًا", en: "Very Good", fr: "Très bien", de: "Sehr gut", tr: "Çok iyi" },
  },
  {
    slug: "good",
    labels: { ar: "جيد", en: "Good", fr: "Bien", de: "Gut", tr: "İyi" },
  },
  {
    slug: "acceptable",
    labels: { ar: "مقبول", en: "Acceptable", fr: "Acceptable", de: "Akzeptabel", tr: "Kabul edilebilir" },
  },
  {
    slug: "needs_improvement",
    labels: { ar: "يحتاج إلى تحسين", en: "Needs Improvement", fr: "À améliorer", de: "Verbesserungsbedarf", tr: "Geliştirme gerekli" },
  },
];

/**
 * Legacy list (Phase 5, removed from the defaults 2026-10-18): rows and
 * AcademySettings values written before per-language labels existed store
 * these plain strings. They keep rendering with sensible labels.
 */
const LEGACY_REMARK_LABELS: Record<string, Partial<Record<ReportLanguageCode, string>>> = {
  excellent: { ar: "ممتاز", en: "Excellent", fr: "Excellent", de: "Hervorragend", tr: "Mükemmel" },
  good: { ar: "جيد", en: "Good", fr: "Bien", de: "Gut", tr: "İyi" },
  acceptable: { ar: "مقبول", en: "Acceptable", fr: "Acceptable", de: "Akzeptabel", tr: "Kabul edilebilir" },
  "needs follow-up": { ar: "يحتاج متابعة", en: "Needs follow-up", fr: "À suivre", de: "Nachfassen nötig", tr: "Takip gerekli" },
};

let settingsTableReady: boolean | null = null;

/** Same owner-applied migration as report_attachments (20261015093512). */
export async function isAcademySettingsReady(): Promise<boolean> {
  if (settingsTableReady === true) return true;
  // information_schema instead of to_regclass — the regclass OID column
  // intermittently fails to deserialize through the transaction-mode pooler
  // (see lib/scheduling/session-requests.ts).
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'academy_settings'",
  )) as { count: number }[];
  settingsTableReady = rows[0]?.count === 1;
  return settingsTableReady;
}

function normalizeStoredOptions(value: unknown): ClassRemarkOption[] | null {
  if (!value || typeof value !== "object") return null;
  const items = (value as { items?: unknown }).items;

  // New shape: [{ slug, labels: { ar, en, ... } }]
  if (Array.isArray(items)) {
    const options: ClassRemarkOption[] = [];
    for (const item of items) {
      if (typeof item === "string" && item.trim().length > 0) {
        // Legacy shape: plain slug strings — map to translated options where known.
        const slug = item.trim();
        options.push({ slug, labels: LEGACY_REMARK_LABELS[slug] ?? { en: slug } });
        continue;
      }
      if (item && typeof item === "object") {
        const { slug, labels } = item as { slug?: unknown; labels?: unknown };
        if (typeof slug === "string" && slug.trim().length > 0 && labels && typeof labels === "object") {
          const clean: Partial<Record<ReportLanguageCode, string>> = {};
          for (const [code, text] of Object.entries(labels as Record<string, unknown>)) {
            if (typeof text === "string" && text.trim().length > 0) {
              clean[code as ReportLanguageCode] = text.trim();
            }
          }
          options.push({ slug: slug.trim(), labels: clean });
        }
      }
    }
    if (options.length > 0) return options;
  }
  return null;
}

/**
 * The academy's active class-remark options with per-language labels. Falls
 * back to the seeded list until the Admin edits it (and until the settings
 * migration is applied).
 */
export async function getClassRemarkOptions(academyId: string): Promise<ClassRemarkOption[]> {
  if (!(await isAcademySettingsReady())) return DEFAULT_CLASS_REMARK_OPTIONS;
  const row = await prisma.academySetting.findUnique({
    where: { academyId_key: { academyId, key: CLASS_REMARKS_SETTING_KEY } },
    select: { value: true },
  });
  return normalizeStoredOptions(row?.value) ?? DEFAULT_CLASS_REMARK_OPTIONS;
}

/** Slug list for submit-time validation (reports.class_remark stores the slug). */
export async function getClassRemarks(academyId: string): Promise<string[]> {
  return (await getClassRemarkOptions(academyId)).map((option) => option.slug);
}

/** Admin-only save (owner decision 2026-10-14 — Supervisors are excluded from system settings). */
export async function setClassRemarkOptions(academyId: string, options: ClassRemarkOption[]): Promise<void> {
  await prisma.academySetting.upsert({
    where: { academyId_key: { academyId, key: CLASS_REMARKS_SETTING_KEY } },
    create: { academyId, key: CLASS_REMARKS_SETTING_KEY, value: { items: options } },
    update: { value: { items: options } },
  });
}
