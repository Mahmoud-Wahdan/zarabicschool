import { prisma } from "../prisma";

let applicationMediaReady = false;
let warnedMissing = false;
let testOverride: boolean | null = null;

/**
 * Migration 20261102120000_application_teacher_media adds intro_video_url
 * and recitation_audio_* columns to the applications table.
 * Until the OWNER applies it, the teacher form returns
 * 409 APPLICATION_MEDIA_MIGRATION_PENDING.
 *
 * Only the POSITIVE result is cached (self-healing after the migration lands
 * — no dev-server restart needed); a negative result is re-checked per call.
 */
export async function isApplicationMediaReady(): Promise<boolean> {
  if (testOverride !== null) return testOverride;
  if (applicationMediaReady) return true;

  // information_schema instead of to_regclass — the regclass OID column
  // intermittently fails to deserialize through the transaction-mode pooler
  // (same pattern as lib/storage/attachment-ready.ts and lib/storage/index.ts).
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'applications' AND column_name = 'intro_video_url'",
  )) as { count: number }[];

  applicationMediaReady = rows[0]?.count === 1;
  if (!applicationMediaReady && !warnedMissing) {
    warnedMissing = true;
    console.warn(
      "[applications] migration 20261102120000_application_teacher_media is not applied yet — teacher applications return APPLICATION_MEDIA_MIGRATION_PENDING until the owner applies it.",
    );
  }
  return applicationMediaReady;
}

/** Test-only helper to override or reset readiness state */
export function __setApplicationMediaReadyForTests(ready: boolean | null) {
  testOverride = ready;
  if (ready === null) {
    applicationMediaReady = false;
    warnedMissing = false;
  }
}
