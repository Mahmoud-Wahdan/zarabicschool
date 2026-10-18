import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { getStorageProvider } from "../../../../../lib/storage";
import { MAX_ATTACHMENT_BYTES, detectAllowedMime } from "../../../../../lib/storage/mime";
import { paymentProofMetaSchema } from "../../../../../lib/validation/financial";
import { allowRequest } from "../../../../../lib/rate-limit";

function isUuid(value: string) {
  return z.string().uuid().safeParse(value).success;
}

/**
 * The payer (guardian of a minor, or an adult student without a guardian) uploads a
 * payment proof for their OWN pending invoice. Same rules as report attachments:
 * JPEG/PNG/WebP/PDF by magic bytes, 10 MB cap, private bucket, server-generated
 * path. A proof is evidence for the Admin — it never settles the invoice itself.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["STUDENT", "GUARDIAN"]);
  if (error) return error;
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid invoice identifier." } }, { status: 400 });
  }
  if (!allowRequest(`invoice-proof:${user.id}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many uploads. Try again later." } }, { status: 429 });
  }
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      academyId: true,
      status: true,
      student: {
        select: {
          userId: true,
          guardianId: true,
          isAdult: true,
          guardian: { select: { userId: true } },
        },
      },
    },
  });
  if (!invoice || invoice.academyId !== user.academyId) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Invoice was not found." } }, { status: 404 });
  }
  const isOwner =
    (user.role === "STUDENT" && invoice.student.isAdult && invoice.student.userId === user.id && !invoice.student.guardianId) ||
    (user.role === "GUARDIAN" && invoice.student.guardian?.userId === user.id);
  if (!isOwner) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Invoice was not found." } }, { status: 404 });
  }
  if (invoice.status !== "PENDING") {
    return NextResponse.json({ error: { code: "INVOICE_NOT_PAYABLE", message: "Proofs apply to pending invoices only." } }, { status: 409 });
  }
  const provider = getStorageProvider();
  if (!provider) {
    return NextResponse.json(
      { error: { code: "STORAGE_NOT_CONFIGURED", message: "Payment proof storage is not configured yet. Ask the Admin to add the Supabase Storage settings." } },
      { status: 409 },
    );
  }
  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A multipart form with a file is required." } }, { status: 400 });
  }
  const meta = paymentProofMetaSchema.safeParse({
    reference: form.get("reference")?.toString() ?? "",
  });
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A proof file is required.", fields: { file: ["No file uploaded."] } } }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "The uploaded file is empty." } }, { status: 400 });
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: { code: "PROOF_TOO_LARGE", message: "The payment proof must be 10 MB or smaller." } }, { status: 413 });
  }
  const detected = detectAllowedMime(buffer);
  if (!detected) {
    return NextResponse.json({ error: { code: "INVALID_PROOF_TYPE", message: "Only images (JPEG, PNG, WebP) and PDF files are allowed." } }, { status: 400 });
  }
  const path = `${user.academyId}/payment-proofs/${invoice.id}/${randomUUID()}.${detected.ext}`;
  const originalName = (file.name.split(/[\\/]/).pop() ?? "proof").trim().slice(0, 200) || "proof";
  try {
    await provider.upload({ path, buffer, contentType: detected.mime });
  } catch {
    return NextResponse.json({ error: { code: "UPLOAD_FAILED", message: "The upload failed. Try again." } }, { status: 502 });
  }
  const proof = await prisma.paymentProof.create({
    data: {
      academyId: user.academyId,
      invoiceId: invoice.id,
      uploadedById: user.id,
      filePath: path,
      mimeType: detected.mime,
      sizeBytes: BigInt(buffer.length),
      originalName,
      reference: meta.success && meta.data.reference ? meta.data.reference : null,
      status: "PENDING",
    },
    select: { id: true, status: true, createdAt: true },
  });
  return NextResponse.json({ data: proof }, { status: 201 });
}
