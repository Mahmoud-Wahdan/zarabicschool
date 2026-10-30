import type { Prisma } from "../../generated/prisma/client";

/**
 * Failed-renewal grace (CONTEXT §7, §20.6; D80 corrected by the owner 2026-10-30):
 * a PAST_DUE renewal keeps booking open for this many days after the period end;
 * only after it are NEW bookings blocked. AcademySettings key
 * `billing.renewal_grace_days`, whole days 1–14, default 3. The value is read when a
 * subscription is marked PAST_DUE and stored as `grace_ends_at`; a later change of the
 * setting does not move a grace that already started.
 */
export const RENEWAL_GRACE_DAYS_KEY = "billing.renewal_grace_days";
export const DEFAULT_RENEWAL_GRACE_DAYS = 3;
export const MIN_RENEWAL_GRACE_DAYS = 1;
export const MAX_RENEWAL_GRACE_DAYS = 14;

export function isValidRenewalGraceDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_RENEWAL_GRACE_DAYS && value <= MAX_RENEWAL_GRACE_DAYS;
}

type SettingsReader = { academySetting: Pick<Prisma.TransactionClient["academySetting"], "findUnique"> };

/** Pure: takes the client, so the worker, routes and tests share it. */
export async function getRenewalGraceDays(db: SettingsReader, academyId: string): Promise<number> {
  const row = await db.academySetting.findUnique({
    where: { academyId_key: { academyId, key: RENEWAL_GRACE_DAYS_KEY } },
    select: { value: true },
  });
  return isValidRenewalGraceDays(row?.value) ? row.value : DEFAULT_RENEWAL_GRACE_DAYS;
}
