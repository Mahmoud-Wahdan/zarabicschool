import "server-only";

import type { Prisma } from "../../generated/prisma/client";
import {
  DEFAULT_JOIN_WINDOW_MINUTES,
  MAX_JOIN_WINDOW_MINUTES,
  MIN_JOIN_WINDOW_MINUTES,
} from "../config/session-join";
import { prisma } from "../prisma";

/** AcademySettings key of the Admin-set join window (D4, OQ-4). */
export const JOIN_WINDOW_SETTING_KEY = "join_window_minutes";

type SettingsClient = Pick<Prisma.TransactionClient, "academySetting">;

export function isValidJoinWindow(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_JOIN_WINDOW_MINUTES &&
    value <= MAX_JOIN_WINDOW_MINUTES
  );
}

/** The academy's join window in minutes; the default when unset or unreadable. */
export async function getJoinWindowMinutes(academyId: string, client: SettingsClient = prisma): Promise<number> {
  try {
    const row = await client.academySetting.findUnique({
      where: { academyId_key: { academyId, key: JOIN_WINDOW_SETTING_KEY } },
      select: { value: true },
    });
    return isValidJoinWindow(row?.value) ? row.value : DEFAULT_JOIN_WINDOW_MINUTES;
  } catch {
    return DEFAULT_JOIN_WINDOW_MINUTES;
  }
}
