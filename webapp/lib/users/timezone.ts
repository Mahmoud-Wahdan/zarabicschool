import { prisma } from "../prisma";

/**
 * Per-user time zone (S-03, D3/D39). Stored as an IANA name with its source:
 * DEFAULT (Africa/Cairo at creation) | DEVICE (browser Intl) | USER | ADMIN. A device
 * zone updates the stored one silently only while the source is DEFAULT or DEVICE;
 * a USER or ADMIN choice is never overwritten by a device.
 */
export type TimeZoneSource = "DEFAULT" | "DEVICE" | "USER" | "ADMIN";

export { isValidTimeZone } from "../validation/time-zone";

export async function applyTimeZone(userId: string, timezone: string, source: Exclude<TimeZoneSource, "DEFAULT">) {
  const current = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true, timezoneSource: true } });
  const deviceMayWrite = current.timezoneSource === "DEFAULT" || current.timezoneSource === "DEVICE";
  if (source === "DEVICE" && (!deviceMayWrite || current.timezone === timezone)) {
    return { timezone: current.timezone, timezoneSource: current.timezoneSource, changed: false };
  }
  await prisma.user.update({ where: { id: userId }, data: { timezone, timezoneSource: source }, select: { id: true } });
  return { timezone, timezoneSource: source, changed: true };
}
