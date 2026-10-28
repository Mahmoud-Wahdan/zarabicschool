jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getServerSession } from "next-auth";

import { POST as myTimezoneRoute } from "../../app/api/me/timezone/route";
import { PATCH as patchProfileRoute } from "../../app/api/admin/profiles/[id]/route";
import { isValidTimeZone } from "../../lib/users/timezone";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * S-03 (D3, D39): the device zone (browser Intl) is stored silently only while the
 * stored zone came from the DEFAULT or the DEVICE; the user's own choice (USER) and
 * the Admin's (ADMIN) are never overwritten by a device. The Supervisor cannot edit
 * zones. Only real IANA names are accepted. Per-run test academy.
 */
jest.setTimeout(180_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
const setMine = (body: unknown, headers = sameOriginHeaders({ "content-type": "application/json" })) =>
  myTimezoneRoute(new Request("http://localhost:3000/api/me/timezone", { method: "POST", headers, body: JSON.stringify(body) }));
const adminSet = (userId: string, timezone: string) =>
  patchProfileRoute(
    new Request(`http://localhost:3000/api/admin/profiles/${userId}`, { method: "PATCH", headers: sameOriginHeaders({ "content-type": "application/json" }), body: JSON.stringify({ timezone }) }),
    { params: Promise.resolve({ id: userId }) },
  );
const stored = (userId: string) => prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true, timezoneSource: true } });

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-03 time zone source", () => {
  it("TZS-01: only real IANA names are valid", () => {
    expect(isValidTimeZone("Africa/Cairo")).toBe(true);
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    for (const bad of ["", "Mars/Olympus", "UTC+3", "../etc", "x".repeat(81)]) expect(isValidTimeZone(bad)).toBe(false);
  });

  it("TZS-02: the device zone is stored while the source is DEFAULT, then follows the device", async () => {
    const userId = fx.studentUserIds.student1;
    as(userId);
    const response = await setMine({ timezone: "Europe/Berlin", source: "DEVICE" });
    expect(response.status).toBe(200);
    expect(await stored(userId)).toEqual({ timezone: "Europe/Berlin", timezoneSource: "DEVICE" });
    await setMine({ timezone: "Asia/Dubai", source: "DEVICE" });
    expect(await stored(userId)).toEqual({ timezone: "Asia/Dubai", timezoneSource: "DEVICE" });
  });

  it("TZS-03: the user's own choice is kept: a later device zone never overwrites it", async () => {
    const userId = fx.studentUserIds.student2;
    as(userId);
    expect((await setMine({ timezone: "America/New_York", source: "USER" })).status).toBe(200);
    const device = await setMine({ timezone: "Europe/Berlin", source: "DEVICE" });
    expect(device.status).toBe(200);
    expect(await device.json()).toEqual({ data: { timezone: "America/New_York", timezoneSource: "USER", changed: false } });
    expect(await stored(userId)).toEqual({ timezone: "America/New_York", timezoneSource: "USER" });
  });

  it("TZS-04: the Admin sets a zone (ADMIN); a device never overwrites it; the user may still choose their own", async () => {
    const userId = fx.teacherUserId;
    as(fx.adminUserId);
    expect((await adminSet(userId, "Asia/Riyadh")).status).toBe(200);
    expect(await stored(userId)).toEqual({ timezone: "Asia/Riyadh", timezoneSource: "ADMIN" });
    as(userId);
    await setMine({ timezone: "Europe/Berlin", source: "DEVICE" });
    expect(await stored(userId)).toEqual({ timezone: "Asia/Riyadh", timezoneSource: "ADMIN" });
    await setMine({ timezone: "Europe/London", source: "USER" });
    expect(await stored(userId)).toEqual({ timezone: "Europe/London", timezoneSource: "USER" });
  });

  it("TZS-05: the Supervisor cannot edit a zone; invalid zones and sources are 400; cross-origin 403; signed-out 401", async () => {
    as(fx.supervisorUserId);
    expect((await adminSet(fx.studentUserIds.student3, "Asia/Riyadh")).status).toBe(403);
    as(fx.adminUserId);
    expect((await adminSet(fx.studentUserIds.student3, "Mars/Olympus")).status).toBe(400);
    as(fx.studentUserIds.student3);
    expect((await setMine({ timezone: "Mars/Olympus", source: "USER" })).status).toBe(400);
    expect((await setMine({ timezone: "Africa/Cairo", source: "ADMIN" })).status).toBe(400);
    expect((await setMine({ timezone: "Africa/Cairo", source: "USER" }, { origin: "https://evil.example", host: "localhost:3000", "content-type": "application/json" })).status).toBe(403);
    getServerSessionMock.mockResolvedValue(null);
    expect((await setMine({ timezone: "Africa/Cairo", source: "USER" })).status).toBe(401);
    expect(await stored(fx.studentUserIds.student3)).toEqual({ timezone: "Africa/Cairo", timezoneSource: "DEFAULT" });
  });

  it("TZS-06 (static): every dashboard reports the device zone once per browser session", () => {
    const shell = readFileSync(join(process.cwd(), "app/_components/dashboard-shell.tsx"), "utf8");
    expect(shell).toMatch(/<DeviceTimeZoneSync/);
    const sync = readFileSync(join(process.cwd(), "app/_components/device-timezone-sync.tsx"), "utf8");
    expect(sync).toMatch(/resolvedOptions\(\)\.timeZone/);
    expect(sync).toMatch(/sessionStorage/);
    expect(sync).toMatch(/source: "DEVICE"/);
  });
});
