import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../../lib/dal";
import { getChargebackEvidence } from "../../../../../../lib/payments/compliance";
import { errorResponse, isUuidParam } from "../../../../../../lib/request";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;

  const { id } = await params;
  if (!isUuidParam(id)) return errorResponse(400, "VALIDATION_ERROR", "Invalid invoice identifier.");

  const evidence = await getChargebackEvidence(user.academyId, id);
  if (!evidence) return errorResponse(404, "NOT_FOUND", "Invoice was not found.");

  const body = JSON.stringify(
    evidence,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="chargeback-evidence-${id.slice(0, 8)}.json"`,
      "cache-control": "no-store",
    },
  });
}
