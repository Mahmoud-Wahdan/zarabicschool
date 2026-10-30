jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { GET as getGraceRoute, PUT as putGraceRoute } from "../../app/api/admin/settings/renewal-grace-days/route";
import { DEFAULT_RENEWAL_GRACE_DAYS, getRenewalGraceDays, RENEWAL_GRACE_DAYS_KEY } from "../../lib/config/renewal-grace";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * D80 correction (owner, 2026-10-30): the renewal grace length is an Admin setting
 * (`billing.renewal_grace_days`, whole days 1–14, default 3; CONTEXT §7 "default 3,
 * configurable"). ADMIN only. Per-run test academy only.
 */
jest.setTimeout(120_000);

const getServerSessionMock = getServerSession as jest.Mock;
const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
let fx: SessionFixtures;

const put = (body: unknown, headers: HeadersInit = sameOriginHeaders({ "content-type": "application/json" })) =>
  new Request("http://localhost:3000/api/admin/settings/renewal-grace-days", { method: "PUT", headers, body: JSON.stringify(body) });

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("renewal grace days setting", () => {
  it("GS-01: default is 3 when nothing is stored", async () => {
    expect(DEFAULT_RENEWAL_GRACE_DAYS).toBe(3);
    expect(await getRenewalGraceDays(prisma, fx.academyId)).toBe(3);
    as(fx.adminUserId);
    expect(await (await getGraceRoute()).json()).toEqual({ data: { days: 3 } });
  });

  it("GS-02: the Admin saves a value in range; out-of-range and non-integers get 400", async () => {
    as(fx.adminUserId);
    expect((await putGraceRoute(put({ days: 5 }))).status).toBe(200);
    expect(await getRenewalGraceDays(prisma, fx.academyId)).toBe(5);
    for (const days of [0, 15, 2.5, "3"]) expect((await putGraceRoute(put({ days }))).status).toBe(400);
    expect(await getRenewalGraceDays(prisma, fx.academyId)).toBe(5);
  });

  it("GS-03: a stored invalid value falls back to the default", async () => {
    await prisma.academySetting.update({ where: { academyId_key: { academyId: fx.academyId, key: RENEWAL_GRACE_DAYS_KEY } }, data: { value: "abc" } });
    expect(await getRenewalGraceDays(prisma, fx.academyId)).toBe(3);
  });

  it("GS-04: the Supervisor and the teacher get 403; a cross-origin PUT is refused", async () => {
    for (const userId of [fx.supervisorUserId, fx.teacherUserId]) {
      as(userId);
      expect((await getGraceRoute()).status).toBe(403);
      expect((await putGraceRoute(put({ days: 4 }))).status).toBe(403);
    }
    as(fx.adminUserId);
    const cross = await putGraceRoute(put({ days: 4 }, { "content-type": "application/json", origin: "https://evil.example" }));
    expect(cross.status).toBe(403);
  });
});
