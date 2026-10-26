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

let followupReady = false;

/**
 * Phase 7 follow-ups (owner, 2026-10-26): users.announcements_opt_out (migration
 * 20261026180000) and the nullable complaint party (20261026190000). Until both are
 * applied the opt-out flag and the "another participant" option stay hidden. Only a
 * positive result is cached.
 */
export async function isPhase7FollowupReady(): Promise<boolean> {
  if (followupReady) return true;
  try {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'users' AND column_name = 'announcements_opt_out') OR (table_name = 'complaints' AND column_name = 'concerned_user_id' AND is_nullable = 'YES'))",
    )) as { count: number }[];
    followupReady = rows[0]?.count === 2;
  } catch {
    return false;
  }
  return followupReady;
}
