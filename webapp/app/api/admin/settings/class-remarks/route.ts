import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole } from "../../../../../lib/dal";
import { CLASS_REMARKS_SETTING_KEY, getClassRemarks, isAcademySettingsReady, setClassRemarks } from "../../../../../lib/reports/class-remarks";

const classRemarksSchema = z.object({
  items: z.array(z.string().trim().min(2).max(60)).min(1).max(8),
}).refine((value) => new Set(value.items).size === value.items.length, "Remarks must be unique.");

/**
 * Admin-only (owner decision 2026-10-14): Supervisors are excluded from system
 * settings (CONTEXT §4). The remark list drives report submission validation.
 */
export async function GET() {
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  const items = await getClassRemarks(user.academyId);
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
  const parsed = classRemarksSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Provide 1-8 unique remarks (2-60 characters).", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  await setClassRemarks(user.academyId, parsed.data.items);
  return NextResponse.json({ data: { key: CLASS_REMARKS_SETTING_KEY, items: parsed.data.items } });
}
