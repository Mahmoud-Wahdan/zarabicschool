import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../../lib/dal";
import {
  EvaluationError,
  getOwnEvaluation,
  submitEvaluation,
} from "../../../../../lib/evaluations/service";
import { errorResponse, isSameOrigin } from "../../../../../lib/request";

export const runtime = "nodejs";

const evaluationSubmitSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});

function isUuid(value: string) {
  return z.guid().safeParse(value).success;
}

/**
 * The caller's OWN evaluation for one session. STUDENT and GUARDIAN only — the
 * teacher has no evaluation surface anywhere (Session 3, Slice B). Admin/Supervisor
 * read through the session-detail data path, never through this route.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["STUDENT", "GUARDIAN"]);
  if (error) return error;
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid session identifier." } }, { status: 400 });
  }
  const evaluation = await getOwnEvaluation(id, {
    userId: user.id,
    role: user.role === "GUARDIAN" ? "GUARDIAN" : "STUDENT",
  });
  return NextResponse.json({ data: evaluation });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request.headers)) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
  }
  const { user, error } = await requireApiRoles(["STUDENT", "GUARDIAN"]);
  if (error) return error;
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid session identifier." } }, { status: 400 });
  }
  const parsed = evaluationSubmitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Provide a rating from 1 to 5 and an optional comment.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  try {
    const { view, created } = await submitEvaluation(
      id,
      { userId: user.id, role: user.role === "GUARDIAN" ? "GUARDIAN" : "STUDENT" },
      { rating: parsed.data.rating, comment: parsed.data.comment ? parsed.data.comment : null },
    );
    return NextResponse.json({ data: view }, { status: created ? 201 : 200 });
  } catch (cause) {
    if (cause instanceof EvaluationError) {
      switch (cause.code) {
        case "NOT_READY":
          return errorResponse(409, "EVALUATIONS_MIGRATION_PENDING", cause.message);
        case "NOT_ON_ROSTER":
          // Generic 404 — roster non-membership must never leak session existence.
          return errorResponse(404, "NOT_FOUND", "Session not found.");
        case "SESSION_NOT_EVALUABLE":
          return errorResponse(409, "SESSION_NOT_EVALUABLE", cause.message);
        case "LOCKED":
          return errorResponse(403, "EVALUATION_LOCKED", cause.message);
        case "CONFLICT":
          return errorResponse(409, "EVALUATION_CONFLICT", cause.message);
      }
    }
    throw cause;
  }
}
