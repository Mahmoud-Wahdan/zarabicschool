import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: "../.env" });

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to clear demo data.`);
  }
  return value;
}

const DEMO_USER_PREFIX = "demo_";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("db:clear:demo refuses to run when NODE_ENV=production.");
  }

  const confirm = process.argv.includes("--confirm");
  const directUrl = required("DIRECT_URL");
  const pool = new Pool({ connectionString: directUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const demoUsers = await prisma.user.findMany({
      where: { username: { startsWith: DEMO_USER_PREFIX } },
      select: { id: true },
    });
    const demoUserIds = demoUsers.map((user) => user.id);
    const demoSubjectIds = (
      await prisma.subject.findMany({ where: { slug: { startsWith: "demo-" } }, select: { id: true } })
    ).map((subject) => subject.id);
    const demoStudentIds = demoUserIds.length
      ? (await prisma.student.findMany({ where: { userId: { in: demoUserIds } }, select: { id: true } })).map((student) => student.id)
      : [];
    const demoTeacherIds = demoUserIds.length
      ? (await prisma.teacher.findMany({ where: { userId: { in: demoUserIds } }, select: { id: true } })).map((teacher) => teacher.id)
      : [];
    const scopedAcademyIds = demoUserIds.length
      ? [...new Set((await prisma.user.findMany({ where: { id: { in: demoUserIds } }, select: { academyId: true } })).map((user) => user.academyId))]
      : [];
    const demoSessionIds = scopedAcademyIds.length
      ? (
          await prisma.session.findMany({
            where: {
              academyId: { in: scopedAcademyIds },
              OR: [
                { teacherId: { in: demoTeacherIds } },
                { students: { some: { studentId: { in: demoStudentIds } } } },
                { createdById: { in: demoUserIds } },
              ],
            },
            select: { id: true },
          })
        ).map((session) => session.id)
      : [];

    // Phase 6 exception guard (3): abort when a NON-demo record shares demo sessions/reports.
    const sharedSessionParticipants = demoSessionIds.length
      ? await prisma.sessionStudent.count({
          where: { sessionId: { in: demoSessionIds }, student: { user: { username: { not: { startsWith: DEMO_USER_PREFIX } } } } },
        })
      : 0;
    const sharedReports = demoSessionIds.length
      ? await prisma.report.count({
          where: { sessionId: { in: demoSessionIds }, student: { user: { username: { not: { startsWith: DEMO_USER_PREFIX } } } } },
        })
      : 0;

    const counts = {
      users: demoUserIds.length,
      students: demoStudentIds.length,
      teachers: demoTeacherIds.length,
      subjects: demoSubjectIds.length,
      sessions: demoSessionIds.length,
      sharedSessionParticipants,
      sharedReports,
    };
    console.log("Demo rows that would be removed:", JSON.stringify(counts));
    if (sharedSessionParticipants > 0 || sharedReports > 0) {
      throw new Error("Refusing to clear: non-demo records share demo sessions/reports. Resolve those first.");
    }

    if (!confirm) {
      console.log("Pass --confirm to delete those rows.");
      return;
    }

    if (demoUserIds.length === 0 && demoSubjectIds.length === 0) {
      console.log("Nothing to clear.");
      return;
    }

    const demoInvoiceIds = scopedAcademyIds.length
      ? (
          await prisma.invoice.findMany({
            where: { academyId: { in: scopedAcademyIds }, student: { userId: { in: demoUserIds } } },
            select: { id: true },
          })
        ).map((invoice) => invoice.id)
      : [];
    await prisma.paymentAttempt.deleteMany({ where: { invoiceId: { in: demoInvoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: demoInvoiceIds } } });

    await prisma.notificationJob.deleteMany({
      where: {
        OR: [
          { recipientUserId: { in: demoUserIds } },
          { sessionId: { in: demoSessionIds } },
        ],
      },
    });
    await prisma.sessionJoinClick.deleteMany({
      where: { OR: [{ userId: { in: demoUserIds } }, { sessionId: { in: demoSessionIds } }] },
    });
    // Phase 4: link-audit rows reference sessions/series/users with ON DELETE RESTRICT —
    // remove the demo ones before the referenced rows. Gated on the owner-applied
    // migration 20261012000000_phase4_link_audit (no URL values are ever stored there).
    const linkAuditTable = (await prisma.$queryRawUnsafe(
      "SELECT to_regclass('session_link_audits') AS regclass",
    )) as { regclass: string | null }[];
    if (linkAuditTable[0]?.regclass) {
      const demoSeriesIds = demoTeacherIds.length
        ? (
            await prisma.recurrenceSeries.findMany({
              where: { teacherId: { in: demoTeacherIds } },
              select: { id: true },
            })
          ).map((series) => series.id)
        : [];
      await prisma.sessionLinkAudit.deleteMany({
        where: {
          OR: [
            { sessionId: { in: demoSessionIds } },
            { seriesId: { in: demoSeriesIds } },
            { changedById: { in: demoUserIds } },
            { academyId: { in: scopedAcademyIds } },
          ],
        },
      });
    }
    await prisma.sessionChangeRequest.deleteMany({
      where: { OR: [{ teacherId: { in: demoTeacherIds } }, { sessionId: { in: demoSessionIds } }] },
    });
    await prisma.teacherFlag.deleteMany({ where: { teacherId: { in: demoTeacherIds } } });

    await prisma.report.deleteMany({ where: { sessionId: { in: demoSessionIds } } });
    await prisma.sessionReservation.deleteMany({ where: { sessionId: { in: demoSessionIds } } });
    await prisma.sessionStudent.deleteMany({ where: { sessionId: { in: demoSessionIds } } });
    await prisma.session.deleteMany({ where: { id: { in: demoSessionIds } } });
    await prisma.recurrenceSeries.deleteMany({ where: { teacherId: { in: demoTeacherIds } } });

    const demoSubscriptionIds = scopedAcademyIds.length
      ? (
          await prisma.subscription.findMany({
            where: { academyId: { in: scopedAcademyIds }, studentId: { in: demoStudentIds } },
            select: { id: true },
          })
        ).map((subscription) => subscription.id)
      : [];
    if (demoSubscriptionIds.length > 0) {
      // Documented Phase 6 exception: transaction-scoped trigger disable, never global.
      await prisma.$transaction([
        prisma.$executeRawUnsafe("ALTER TABLE subscription_ledger DISABLE TRIGGER subscription_ledger_append_only"),
        prisma.subscriptionLedger.deleteMany({ where: { subscriptionId: { in: demoSubscriptionIds } } }),
        prisma.$executeRawUnsafe("ALTER TABLE subscription_ledger ENABLE TRIGGER subscription_ledger_append_only"),
      ]);
    }
    await prisma.subscription.deleteMany({ where: { id: { in: demoSubscriptionIds } } });

    await prisma.studentTeacherAssignment.deleteMany({
      where: {
        OR: [
          { studentId: { in: demoStudentIds } },
          { teacherId: { in: demoTeacherIds } },
          { createdById: { in: demoUserIds } },
        ],
      },
    });
    await prisma.studentSubject.deleteMany({ where: { studentId: { in: demoStudentIds } } });
    await prisma.teacherSubject.deleteMany({
      where: { OR: [{ teacherId: { in: demoTeacherIds } }, { subjectId: { in: demoSubjectIds } }] },
    });
    await prisma.applicationRecord.deleteMany({ where: { userId: { in: demoUserIds } } });
    await prisma.application.deleteMany({
      where: { OR: [{ approvedUserId: { in: demoUserIds } }, { approvedById: { in: demoUserIds } }] },
    });
    await prisma.student.deleteMany({ where: { userId: { in: demoUserIds } } });
    await prisma.guardian.deleteMany({ where: { userId: { in: demoUserIds } } });
    await prisma.teacher.deleteMany({ where: { userId: { in: demoUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: demoUserIds } } });
    await prisma.subject.deleteMany({ where: { id: { in: demoSubjectIds } } });

    console.log("Demo data cleared.");
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
