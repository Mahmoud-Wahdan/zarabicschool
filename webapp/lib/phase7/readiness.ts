import "server-only";

import { prisma } from "../prisma";

let phase7Ready = false;
let warnedMissing = false;

/**
 * Phase 7 tables (announcements, complaints) arrive with migration
 * 20261026170000_phase7_announcements_complaints, which the OWNER applies. Until
 * then every Phase 7 page/widget/route degrades to a "pending migration" state
 * instead of crashing. Only a positive result is cached (self-heals once applied;
 * information_schema COUNT(*)::int — the deserializable probe pattern).
 */
export async function isPhase7Ready(): Promise<boolean> {
  if (phase7Ready) return true;
  try {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('announcements', 'complaints')",
    )) as { count: number }[];
    phase7Ready = rows[0]?.count === 2;
    if (!phase7Ready && !warnedMissing) {
      warnedMissing = true;
      console.warn("[phase7] migration 20261026170000_phase7_announcements_complaints is pending — announcements and complaints are disabled until the owner applies it.");
    }
  } catch {
    return false;
  }
  return phase7Ready;
}
