import { NextResponse } from "next/server";

import { requireApiRole } from "../../../../../lib/dal";
import {
  CLASS_REMARKS_SETTING_KEY,
  getClassRemarkOptions,
  isAcademySettingsReady,
  setClassRemarkOptions,
  type ClassRemarkOption,
} from "../../../../../lib/reports/class-remarks";
import { classRemarksUpdateSchema } from "../../../../../lib/validation/management";

/**
 * Admin-only (owner decision 2026-10-14): Supervisors are excluded from system
 * settings (CONTEXT §4). The remark list drives report submission validation.
 *
 * Session 1 (owner, 2026-10-18): every option carries a label per report language
 * (ar/en/fr/de/tr — CONTEXT §9); `slug` is what gets stored on reports and must
 * be unique within the list.
 */
export async function GET() {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const items = await getClassRemarkOptions(user.academyId);
  return NextResponse.json({ data: { key: CLASS_REMARKS_SETTING_KEY, items } });
}

export async function PUT(request: Request) {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  if (!(await isAcademySettingsReady())) {
    return NextResponse.json(
      { error: { code: "ATTACHMENTS_MIGRATION_PENDING", message: "Settings storage is not applied yet. Run the pending migration first." } },
      { status: 409 },
    );
  }
  const parsed = classRemarksUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Provide 1-16 options, each with a label in every report language.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  const slugs = new Set<string>();
  for (const item of parsed.data.items) {
    if (slugs.has(item.slug)) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Remark slugs must be unique.", fields: { items: [`Duplicate slug: ${item.slug}`] } } }, { status: 400 });
    }
    slugs.add(item.slug);
  }
  const items: ClassRemarkOption[] = parsed.data.items.map((item) => ({
    slug: item.slug,
    labels: {
      ar: item.labels.ar,
      en: item.labels.en,
      fr: item.labels.fr,
      de: item.labels.de,
      tr: item.labels.tr,
    },
  }));
  await setClassRemarkOptions(user.academyId, items);
  return NextResponse.json({ data: { key: CLASS_REMARKS_SETTING_KEY, items } });
}
