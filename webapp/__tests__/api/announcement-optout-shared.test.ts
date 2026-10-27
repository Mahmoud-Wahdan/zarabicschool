import { computeAnnouncementRecipients } from "../../lib/announcements/service";
import { prisma } from "../../lib/prisma";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * I-3 (second review, owner 2026-10-27): the Admin-only "no announcements" flag
 * protects the NUMBER. When an opted-out user shares a WhatsApp number with another
 * account (a guardian and the child on the same phone), no announcement may reach
 * that number through the other account. Per-run test academy only.
 */
jest.setTimeout(120_000);

let fx: SessionFixtures;

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

it("AN-OPT-01: a number shared with an opted-out user receives nothing, whichever account comes first", async () => {
  const guardian = await prisma.user.findUniqueOrThrow({ where: { id: fx.guardianUserId }, select: { phone: true } });
  // student12 shares the guardian's number (written in a different format), the guardian opts out.
  const sharedLocal = (guardian.phone ?? "").replace(/^\+20/, "0");
  await prisma.user.update({ where: { id: fx.studentUserIds.student12 }, data: { phone: sharedLocal } });
  await prisma.user.update({ where: { id: fx.guardianUserId }, data: { announcementsOptOut: true } });

  const result = await computeAnnouncementRecipients(fx.academyId);
  expect(result.recipientUserIds).not.toContain(fx.guardianUserId);
  expect(result.recipientUserIds).not.toContain(fx.studentUserIds.student12);
  expect(result.optedOut).toBe(1);

  // The reverse: the account that opted out is the student; the guardian on the same number gets nothing either.
  await prisma.user.update({ where: { id: fx.guardianUserId }, data: { announcementsOptOut: false } });
  await prisma.user.update({ where: { id: fx.studentUserIds.student12 }, data: { announcementsOptOut: true } });
  const reverse = await computeAnnouncementRecipients(fx.academyId);
  expect(reverse.recipientUserIds).not.toContain(fx.guardianUserId);
  expect(reverse.recipientUserIds).not.toContain(fx.studentUserIds.student12);
});
