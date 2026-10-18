import { config as dotenvConfig } from "dotenv";
import { createHash } from "node:crypto";

dotenvConfig({ path: "../.env" });

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { Prisma, PrismaClient } from "../generated/prisma/client";
import { addMonthsUtc } from "../lib/credits/period";
import { reserveCredit } from "../lib/credits/reserve-credit";
import { enqueueSessionJobs } from "../lib/notifications/session-jobs";
import { wallClockToUtc } from "../lib/schedules/recurrence";
import bcrypt from "bcrypt";

// =============================================================================
// FULL DEMO SEED — covers every table in the schema (except tables that do not
// exist in this schema yet: evaluations, payroll ledger, teacher rates).
// Demo data only. Never run against production: every user gets the same password.
// =============================================================================

const DEMO_PASSWORD = "M.w.s.2004";
const academyName = "Zarabicschool";
const demoTimezone = "Africa/Cairo";

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

// ---------- ids ----------------------------------------------------------------
/** Legacy fixed ids (kept so re-running over an already-seeded DB stays idempotent). */
const L = (n: string) => `00000000-0000-0000-0000-000000000${n}`;
/** New deterministic ids: group = table family, n = running number. */
const uid = (group: number, n: number) =>
  `00000000-0000-4000-8000-${group.toString(16).padStart(4, "0")}${n.toString(16).padStart(8, "0")}`;
const SUB = (n: number) => uid(1, n);
const INV = (n: number) => uid(2, n);
const S = (n: number) => uid(3, n);
const SER = (n: number) => uid(4, n);
const REQ = (n: number) => uid(5, n);
const CHG = (n: number) => uid(6, n);
const APP = (n: number) => uid(7, n);
const CLK = (n: number) => uid(8, n);
const AUD = (n: number) => uid(9, n);

// ---------- time helpers ----------------------------------------------------------
/** Wall-clock instant at `hour:00` on the Cairo calendar date offset by `dayDelta` days. */
function cairoWallClock(dayDelta: number, hour: number): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: demoTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const base = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + dayDelta, hour, 0, 0));
  return wallClockToUtc(base, demoTimezone);
}

const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MIN);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

// ---------- types -----------------------------------------------------------------
type Who = "admin" | "supervisor";
type PackageType = "MONTHLY_PLAN" | "ANNUAL_PLAN" | "PAY_PER_SESSION";
type Currency = "EGP" | "USD";
type Provider = "PAYMOB" | "USD_GATEWAY";
type InvoiceStatus = "PENDING" | "PAID" | "FAILED" | "CANCELLED";
type AttemptStatus = "CREATED" | "REDIRECTED" | "SUCCEEDED" | "FAILED";
type SubStatus = "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "CANCELLED";
type SessionStatus = "SCHEDULED" | "COMPLETED" | "MISSED" | "CANCELLED";
type Attendance = "PENDING" | "ATTENDED" | "STUDENT_ABSENT";
type ReservationStatus = "RESERVED" | "RELEASED" | "CONSUMED";

type ReportSpec = {
  status: "SUBMITTED" | "REJECTED" | "APPROVED" | "ARCHIVED";
  outcome: "ATTENDED" | "STUDENT_ABSENT";
  remark: string;
  summary: string;
  homework: string;
  notes?: string;
  events?: Record<string, unknown>;
  extra?: { minutes: number; status: "PENDING" | "APPROVED" | "REJECTED" };
  by?: Who;
  rejection?: string;
  attachments?: { name: string; mime: string; size: number }[];
};

type SessionStudentSpec = {
  u: string;
  attendance: Attendance;
  reservation: ReservationStatus | null;
  report?: ReportSpec;
  creditOverride?: { by: Who; reason: string };
};

type SessionSpec = {
  id: string;
  teacher: string;
  subject: string;
  type: "PRIVATE" | "GROUP";
  start: Date;
  minutes?: number;
  status: SessionStatus;
  zoom: string;
  host?: boolean;
  students: SessionStudentSpec[];
  series?: { id: string; week: number };
  replacementFor?: string;
  cancel?: { by: Who; reason: string };
  assignmentOverride?: { by: Who; reason: string };
};

type InvoiceSpec = {
  id: string;
  student: string;
  subscriptionId?: string | null;
  provider: Provider;
  currency: Currency;
  amount: number;
  status: InvoiceStatus;
  type: PackageType;
  sessions: number;
  exchangeRate?: string;
  ref?: string;
  paidAt?: Date;
  attempts: { key: string; status: AttemptStatus; ref?: string; checkout?: string; hash?: string }[];
};

type SubSpec = {
  id: string;
  student: string;
  type: PackageType;
  sessions: number;
  amountMinor: number;
  currency: Currency;
  startDaysAgo: number;
  status: SubStatus;
  invoice?: { id: string; provider: Provider; ref: string; exchangeRate?: string };
  extraLedger?: { entryType: "ADMIN_ADJUSTMENT" | "EXPIRY" | "REFUND"; delta: number }[];
};

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the demo seed.`);
  return value;
}

// ---------- static data -----------------------------------------------------------
const demoSubjects = [
  { slug: "demo-quran", nameAr: "القرآن الكريم", nameEn: "Quran", descriptionAr: "تلاوة وتجويد وحفظ بإشراف معلمات متخصصات", descriptionEn: "Recitation, tajweed, and memorization with specialized female teachers", icon: "book-open", sortOrder: 1 },
  { slug: "demo-arabic", nameAr: "اللغة العربية", nameEn: "Arabic", descriptionAr: "قراءة وكتابة ونحو بأسلوب يناسب مستوى كل طالب", descriptionEn: "Reading, writing, and grammar matched to each student's level", icon: "languages", sortOrder: 2 },
  { slug: "demo-english", nameAr: "اللغة الإنجليزية", nameEn: "English", descriptionAr: "محادثة وقواعد ومفردات لتتكلم بثقة", descriptionEn: "Conversation, grammar, and vocabulary to speak with confidence", icon: "message-circle", sortOrder: 3 },
  { slug: "demo-fiqh", nameAr: "الفقه", nameEn: "Fiqh", descriptionAr: "تعلّم أحكام العبادات والمعاملات بأسلوب مبسّط", descriptionEn: "Rulings of worship and transactions, explained simply", icon: "scale", sortOrder: 4 },
  { slug: "demo-math", nameAr: "الرياضيات", nameEn: "Math", descriptionAr: "شرح مبسّط وتدريب مستمر يبني الفهم قبل الحفظ", descriptionEn: "Clear explanation and ongoing practice that builds understanding before memorization", icon: "calculator", sortOrder: 5 },
];

const supervisorSpecs = [
  { username: "demo_supervisor", name: "Demo Supervisor", phone: "+201000000201" },
  { username: "demo_supervisor_2", name: "Demo Supervisor Two", phone: "+201000000202" },
];

const teacherSpecs = [
  { username: "demo_teacher", name: "Demo Teacher", phone: "+201000000301", subjects: ["demo-quran"] },
  { username: "demo_teacher_quran", name: "Demo Quran Teacher", phone: "+201000000302", subjects: ["demo-quran"] },
  { username: "demo_teacher_lang", name: "Demo Language Teacher", phone: "+201000000303", subjects: ["demo-english", "demo-arabic"] },
  { username: "demo_teacher_multi", name: "Demo Multi-Subject Teacher", phone: "+201000000304", subjects: ["demo-quran", "demo-english"] },
  { username: "demo_teacher_math", name: "Demo Math Teacher", phone: "+201000000305", subjects: ["demo-math", "demo-fiqh"] },
];

const guardianSpecs = [
  { username: "demo_guardian", name: "Demo Guardian", rel: "MOTHER" as const, phone: "+201000000101", tz: "Africa/Cairo", lang: "ar" },
  { username: "demo_guardian_2", name: "Demo Guardian Two", rel: "FATHER" as const, phone: "+14155550102", tz: "America/New_York", lang: "en" },
  { username: "demo_guardian_3", name: "Demo Guardian Three", rel: "MOTHER" as const, phone: "+966500000103", tz: "Asia/Riyadh", lang: "ar" },
  { username: "demo_guardian_4", name: "Demo Guardian Four", rel: "FATHER" as const, phone: "+447700900104", tz: "Europe/London", lang: "en" },
  { username: "demo_guardian_5", name: "Demo Guardian Five", rel: "MOTHER" as const, phone: "+201000000105", tz: "Africa/Cairo", lang: "ar" },
];

type StudentSpec = {
  username: string;
  name: string;
  guardian: string | null;
  isAdult?: boolean;
  subjects: string[];
  assign: [subject: string, teacher: string][];
  phone: string;
};

const studentSpecs: StudentSpec[] = [
  { username: "demo_student", name: "Demo Student", guardian: "demo_guardian", subjects: ["demo-quran"], assign: [["demo-quran", "demo_teacher"]], phone: "+201000001001" },
  { username: "demo_student_credit_many", name: "Demo Student Credit Many", guardian: "demo_guardian", subjects: ["demo-quran"], assign: [["demo-quran", "demo_teacher_quran"]], phone: "+201000001002" },
  { username: "demo_student_credit_one", name: "Demo Student Credit One", guardian: null, subjects: ["demo-quran"], assign: [["demo-quran", "demo_teacher_quran"]], phone: "+201000001003" },
  { username: "demo_student_zero", name: "Demo Student Zero Credit", guardian: null, subjects: ["demo-quran"], assign: [["demo-quran", "demo_teacher_quran"]], phone: "+201000001004" },
  { username: "demo_student_nosub", name: "Demo Student No Subscription", guardian: null, subjects: ["demo-quran"], assign: [["demo-quran", "demo_teacher_quran"]], phone: "+201000001005" },
  { username: "demo_student_unassigned", name: "Demo Student Unassigned", guardian: null, subjects: ["demo-quran"], assign: [], phone: "+201000001006" },
  { username: "demo_student_group_a", name: "Demo Student Group A", guardian: "demo_guardian", subjects: ["demo-quran"], assign: [["demo-quran", "demo_teacher_quran"]], phone: "+201000001007" },
  { username: "demo_student_group_b", name: "Demo Student Group B", guardian: "demo_guardian", subjects: ["demo-quran"], assign: [["demo-quran", "demo_teacher_quran"]], phone: "+201000001008" },
  // --- new ---
  { username: "demo_student_annual", name: "Demo Student Annual Plan", guardian: "demo_guardian_2", subjects: ["demo-english", "demo-quran"], assign: [["demo-english", "demo_teacher_multi"], ["demo-quran", "demo_teacher_quran"]], phone: "+14155551009" },
  { username: "demo_student_usd", name: "Demo Student USD Plan", guardian: "demo_guardian_2", subjects: ["demo-math"], assign: [["demo-math", "demo_teacher_math"]], phone: "+14155551010" },
  { username: "demo_student_payper", name: "Demo Student Pay Per Session", guardian: "demo_guardian_3", subjects: ["demo-english"], assign: [["demo-english", "demo_teacher_multi"]], phone: "+966500001011" },
  { username: "demo_student_cancelled", name: "Demo Student Cancelled Plan", guardian: "demo_guardian_3", subjects: ["demo-arabic"], assign: [["demo-arabic", "demo_teacher_lang"]], phone: "+966500001012" },
  { username: "demo_student_series", name: "Demo Student Weekly Series", guardian: "demo_guardian_4", subjects: ["demo-quran"], assign: [["demo-quran", "demo_teacher_quran"]], phone: "+447700901013" },
  { username: "demo_student_exhausted", name: "Demo Student Exhausted Plan", guardian: "demo_guardian_4", subjects: ["demo-fiqh"], assign: [["demo-fiqh", "demo_teacher_math"]], phone: "+447700901014" },
  { username: "demo_student_expired", name: "Demo Student Expired Plan", guardian: "demo_guardian_4", subjects: ["demo-english"], assign: [["demo-english", "demo_teacher_multi"]], phone: "+447700901015" },
  { username: "demo_student_adult", name: "Demo Adult Student", guardian: null, isAdult: true, subjects: ["demo-arabic", "demo-english"], assign: [["demo-arabic", "demo_teacher_lang"], ["demo-english", "demo_teacher_multi"]], phone: "+201000001016" },
  { username: "demo_student_credit_big", name: "Demo Student Credit Big", guardian: "demo_guardian_5", subjects: ["demo-quran"], assign: [["demo-quran", "demo_teacher_multi"]], phone: "+201000001017" },
  { username: "demo_student_missed", name: "Demo Student Missed Session", guardian: "demo_guardian_5", subjects: ["demo-quran"], assign: [["demo-quran", "demo_teacher_multi"]], phone: "+201000001018" },
];

// ---------- subscriptions (credit) ------------------------------------------------
const subSpecs: SubSpec[] = [
  { id: L("601"), student: "demo_student", type: "MONTHLY_PLAN", sessions: 8, amountMinor: 80000, currency: "EGP", startDaysAgo: 0, status: "ACTIVE" },
  { id: L("609"), student: "demo_student_credit_many", type: "MONTHLY_PLAN", sessions: 8, amountMinor: 80000, currency: "EGP", startDaysAgo: 10, status: "ACTIVE", invoice: { id: INV(10), provider: "PAYMOB", ref: "PM-DEMO-0010" } },
  { id: L("60a"), student: "demo_student_credit_one", type: "MONTHLY_PLAN", sessions: 1, amountMinor: 10000, currency: "EGP", startDaysAgo: 10, status: "ACTIVE" },
  { id: L("60b"), student: "demo_student_zero", type: "MONTHLY_PLAN", sessions: 0, amountMinor: 0, currency: "EGP", startDaysAgo: 10, status: "ACTIVE" },
  { id: L("60c"), student: "demo_student_group_a", type: "MONTHLY_PLAN", sessions: 4, amountMinor: 40000, currency: "EGP", startDaysAgo: 10, status: "ACTIVE" },
  { id: L("60d"), student: "demo_student_group_b", type: "MONTHLY_PLAN", sessions: 4, amountMinor: 40000, currency: "EGP", startDaysAgo: 10, status: "ACTIVE" },
  // Annual: paid once, 8 sessions granted per month with no rollover (this row = the current month's grant).
  { id: SUB(1), student: "demo_student_annual", type: "ANNUAL_PLAN", sessions: 8, amountMinor: 960000, currency: "EGP", startDaysAgo: 10, status: "ACTIVE", invoice: { id: INV(11), provider: "PAYMOB", ref: "PM-DEMO-0011" } },
  { id: SUB(2), student: "demo_student_usd", type: "MONTHLY_PLAN", sessions: 10, amountMinor: 12000, currency: "USD", startDaysAgo: 10, status: "ACTIVE", invoice: { id: INV(12), provider: "USD_GATEWAY", ref: "DODO-DEMO-0012", exchangeRate: "48.50000000" } },
  { id: SUB(3), student: "demo_student_payper", type: "PAY_PER_SESSION", sessions: 16, amountMinor: 160000, currency: "EGP", startDaysAgo: 10, status: "ACTIVE", invoice: { id: INV(13), provider: "PAYMOB", ref: "PM-DEMO-0013" } },
  { id: SUB(4), student: "demo_student_adult", type: "MONTHLY_PLAN", sessions: 8, amountMinor: 80000, currency: "EGP", startDaysAgo: 10, status: "ACTIVE", invoice: { id: INV(14), provider: "PAYMOB", ref: "PM-DEMO-0014" } },
  { id: SUB(5), student: "demo_student_credit_big", type: "MONTHLY_PLAN", sessions: 8, amountMinor: 80000, currency: "EGP", startDaysAgo: 10, status: "ACTIVE", invoice: { id: INV(15), provider: "PAYMOB", ref: "PM-DEMO-0015" }, extraLedger: [{ entryType: "ADMIN_ADJUSTMENT", delta: 4 }] },
  { id: SUB(6), student: "demo_student_missed", type: "MONTHLY_PLAN", sessions: 8, amountMinor: 12000, currency: "USD", startDaysAgo: 10, status: "ACTIVE", invoice: { id: INV(16), provider: "USD_GATEWAY", ref: "DODO-DEMO-0016", exchangeRate: "48.50000000" } },
  { id: SUB(7), student: "demo_student_series", type: "PAY_PER_SESSION", sessions: 3, amountMinor: 30000, currency: "EGP", startDaysAgo: 5, status: "ACTIVE", invoice: { id: INV(17), provider: "PAYMOB", ref: "PM-DEMO-0017" } },
  { id: SUB(8), student: "demo_student_exhausted", type: "MONTHLY_PLAN", sessions: 4, amountMinor: 40000, currency: "EGP", startDaysAgo: 42, status: "EXHAUSTED", invoice: { id: INV(18), provider: "PAYMOB", ref: "PM-DEMO-0018" } },
  { id: SUB(9), student: "demo_student_expired", type: "MONTHLY_PLAN", sessions: 8, amountMinor: 80000, currency: "EGP", startDaysAgo: 52, status: "EXPIRED", invoice: { id: INV(19), provider: "PAYMOB", ref: "PM-DEMO-0019" }, extraLedger: [{ entryType: "EXPIRY", delta: -5 }] },
  { id: SUB(10), student: "demo_student_cancelled", type: "MONTHLY_PLAN", sessions: 8, amountMinor: 80000, currency: "EGP", startDaysAgo: 20, status: "CANCELLED", invoice: { id: INV(20), provider: "PAYMOB", ref: "PM-DEMO-0020" }, extraLedger: [{ entryType: "REFUND", delta: -8 }] },
];

// Invoices that are not the "paid invoice of a subscription": pending / failed / cancelled / renewal.
const standaloneInvoices: InvoiceSpec[] = [
  {
    id: L("602"), student: "demo_student", provider: "PAYMOB", currency: "EGP", amount: 80000, status: "PENDING", type: "MONTHLY_PLAN", sessions: 8,
    attempts: [
      { key: "demo-invoice-checkout-attempt", status: "CREATED" },
      { key: "demo-invoice-checkout-attempt-2", status: "REDIRECTED", ref: "PM-DEMO-0602", checkout: "https://accept.paymob.com/unifiedcheckout/?demo=602" },
    ],
  },
  { id: INV(1), student: "demo_student_credit_many", subscriptionId: L("609"), provider: "PAYMOB", currency: "EGP", amount: 80000, status: "PENDING", type: "MONTHLY_PLAN", sessions: 8, attempts: [{ key: "demo-renewal-attempt-1", status: "CREATED" }] },
  { id: INV(2), student: "demo_student_zero", provider: "PAYMOB", currency: "EGP", amount: 80000, status: "FAILED", type: "MONTHLY_PLAN", sessions: 8, attempts: [{ key: "demo-failed-attempt-1", status: "FAILED", ref: "PM-DEMO-FAIL-1" }] },
  { id: INV(3), student: "demo_student_nosub", provider: "USD_GATEWAY", currency: "USD", amount: 12000, status: "CANCELLED", type: "MONTHLY_PLAN", sessions: 8, exchangeRate: "48.50000000", attempts: [{ key: "demo-cancelled-attempt-1", status: "CREATED" }] },
  { id: INV(4), student: "demo_student_unassigned", provider: "USD_GATEWAY", currency: "USD", amount: 12000, status: "PENDING", type: "MONTHLY_PLAN", sessions: 8, exchangeRate: "48.50000000", attempts: [{ key: "demo-usd-pending-attempt-1", status: "REDIRECTED", ref: "DODO-DEMO-PEND-1", checkout: "https://checkout.dodopayments.com/demo-pending-1" }] },
  { id: INV(5), student: "demo_student_usd", subscriptionId: SUB(2), provider: "USD_GATEWAY", currency: "USD", amount: 12000, status: "PENDING", type: "MONTHLY_PLAN", sessions: 10, exchangeRate: "48.50000000", attempts: [{ key: "demo-usd-renewal-attempt-1", status: "CREATED" }] },
];

// ---------- report builders ---------------------------------------------------------
const rep = (over: Partial<ReportSpec> = {}): ReportSpec => ({
  status: "ARCHIVED",
  outcome: "ATTENDED",
  remark: "good",
  summary: "تمت مراجعة الدرس السابق وشرح الجزء الجديد مع تمارين تطبيقية.",
  homework: "حل التمارين المرفقة ومراجعة الدرس يومياً.",
  by: "admin",
  ...over,
});
const repAbsent = (over: Partial<ReportSpec> = {}): ReportSpec =>
  rep({ outcome: "STUDENT_ABSENT", remark: "needs_follow_up", summary: "لم يحضر الطالب الحصة ولم يتم التواصل معه.", homework: "لا يوجد", ...over });

async function main() {
  const directUrl = required("DIRECT_URL");
  const pool = new Pool({ connectionString: directUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    // =========================================================================
    // Academy + subjects + settings
    // =========================================================================
    const academy = await prisma.academy.upsert({
      where: { name: academyName },
      update: {},
      create: { name: academyName },
    });
    const academyId = academy.id;

    const subjectIds: Record<string, string> = {};
    for (const subject of demoSubjects) {
      const row = await prisma.subject.upsert({
        where: { academyId_slug: { academyId, slug: subject.slug } },
        update: { nameAr: subject.nameAr, nameEn: subject.nameEn, descriptionAr: subject.descriptionAr, descriptionEn: subject.descriptionEn, icon: subject.icon, sortOrder: subject.sortOrder, isActive: true },
        create: { academyId, ...subject, isActive: true },
      });
      subjectIds[subject.slug] = row.id;
    }

    const settings: Record<string, Prisma.InputJsonValue> = {
      class_remark_options: ["excellent", "good", "acceptable", "needs_follow_up"],
      pay_per_session_min: 1,
      pay_per_session_max: 16,
      grace_period_days: 3,
      late_report_reminder_minutes: 15,
      late_report_red_mark_minutes: 30,
      report_attachment_max_bytes: 10 * 1024 * 1024,
      report_attachment_mime_types: ["image/png", "image/jpeg", "application/pdf"],
      default_session_minutes: 60,
    };
    for (const [key, value] of Object.entries(settings)) {
      await prisma.academySetting.upsert({
        where: { academyId_key: { academyId, key } },
        update: { value },
        create: { academyId, key, value },
      });
    }

    // =========================================================================
    // Users (everyone gets the same demo password)
    // =========================================================================
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

    const admin = await prisma.user.findFirstOrThrow({ where: { academyId, role: "ADMIN" }, select: { id: true } });
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash, mustChangePassword: false, isActive: true } });

    type Person = { userId: string; profileId: string };
    const P: Record<string, Person> = {};
    const roleOf: Record<string, "SUPERVISOR" | "TEACHER" | "STUDENT" | "GUARDIAN"> = {};

    async function upsertUser(
      username: string,
      displayName: string,
      role: "SUPERVISOR" | "TEACHER" | "STUDENT" | "GUARDIAN",
      options: { phone?: string; timezone?: string; lang?: string; email?: string } = {}
    ) {
      const common = {
        displayName,
        passwordHash,
        isActive: true,
        mustChangePassword: false,
        phone: options.phone ?? null,
        email: options.email ?? null,
        timezone: options.timezone ?? "Africa/Cairo",
        preferredLanguage: options.lang ?? "ar",
      };
      const user = await prisma.user.upsert({
        where: { academyId_username: { academyId, username } },
        update: common,
        create: { academyId, username, role, ...common },
      });
      roleOf[username] = role;
      return user;
    }

    // Supervisors
    const supervisorIds: string[] = [];
    for (const s of supervisorSpecs) {
      const user = await upsertUser(s.username, s.name, "SUPERVISOR", { phone: s.phone, email: `${s.username}@example.test` });
      P[s.username] = { userId: user.id, profileId: user.id };
      supervisorIds.push(user.id);
    }
    const supervisorId = supervisorIds[0];
    const by = (who: Who) => (who === "admin" ? admin.id : supervisorId);

    // Teachers
    for (const t of teacherSpecs) {
      const user = await upsertUser(t.username, t.name, "TEACHER", { phone: t.phone, email: `${t.username}@example.test` });
      const profile = await prisma.teacher.upsert({
        where: { userId: user.id },
        update: { academyId },
        create: { userId: user.id, academyId },
      });
      for (const slug of t.subjects) {
        await prisma.teacherSubject.upsert({
          where: { teacherId_subjectId: { teacherId: profile.id, subjectId: subjectIds[slug] } },
          update: { academyId },
          create: { academyId, teacherId: profile.id, subjectId: subjectIds[slug] },
        });
      }
      P[t.username] = { userId: user.id, profileId: profile.id };
    }

    // Guardians
    for (const g of guardianSpecs) {
      const user = await upsertUser(g.username, g.name, "GUARDIAN", { phone: g.phone, timezone: g.tz, lang: g.lang, email: `${g.username}@example.test` });
      const profile = await prisma.guardian.upsert({
        where: { userId: user.id },
        update: { academyId, relationship: g.rel },
        create: { userId: user.id, academyId, relationship: g.rel },
      });
      P[g.username] = { userId: user.id, profileId: profile.id };
    }

    // Students + subjects
    let enrollmentOffset = 60;
    for (const s of studentSpecs) {
      const user = await upsertUser(s.username, s.name, "STUDENT", { phone: s.phone, lang: s.guardian === "demo_guardian_2" || s.guardian === "demo_guardian_4" ? "en" : "ar" });
      const guardianId = s.guardian ? P[s.guardian].profileId : null;
      const profile = await prisma.student.upsert({
        where: { userId: user.id },
        update: { academyId, guardianId, isAdult: s.isAdult ?? false },
        create: { userId: user.id, academyId, guardianId, isAdult: s.isAdult ?? false, enrollmentDate: new Date(Date.now() - enrollmentOffset * DAY) },
      });
      enrollmentOffset += 7;
      for (const slug of s.subjects) {
        await prisma.studentSubject.upsert({
          where: { studentId_subjectId: { studentId: profile.id, subjectId: subjectIds[slug] } },
          update: { academyId },
          create: { academyId, studentId: profile.id, subjectId: subjectIds[slug] },
        });
      }
      P[s.username] = { userId: user.id, profileId: profile.id };
    }

    // =========================================================================
    // Student ↔ teacher assignments
    // =========================================================================
    async function ensureActiveAssignment(studentId: string, teacherId: string, subjectId: string) {
      const existing = await prisma.studentTeacherAssignment.findFirst({
        where: { academyId, studentId, teacherId, subjectId, status: "ACTIVE" },
        select: { id: true },
      });
      if (existing) return;
      const conflicting = await prisma.studentTeacherAssignment.findFirst({
        where: { academyId, studentId, subjectId, status: "ACTIVE" },
        select: { id: true },
      });
      if (conflicting) {
        await prisma.studentTeacherAssignment.update({
          where: { id: conflicting.id },
          data: { status: "ENDED", endedAt: new Date(), endedReason: "Demo seed: realigned to the documented scenario teacher" },
        });
      }
      await prisma.studentTeacherAssignment.create({
        data: { academyId, studentId, teacherId, subjectId, status: "ACTIVE", createdById: admin.id },
      });
    }

    for (const s of studentSpecs) {
      for (const [subject, teacher] of s.assign) {
        await ensureActiveAssignment(P[s.username].profileId, P[teacher].profileId, subjectIds[subject]);
      }
    }
    // ENDED history rows (teacher changed).
    const endedHistory: { student: string; teacher: string; subject: string; reason: string; daysAgo: number }[] = [
      { student: "demo_student_unassigned", teacher: "demo_teacher_multi", subject: "demo-quran", reason: "Demo: teacher changed, not yet replaced", daysAgo: 2 },
      { student: "demo_student_cancelled", teacher: "demo_teacher_quran", subject: "demo-quran", reason: "Demo: student moved to Arabic lessons", daysAgo: 30 },
    ];
    for (const h of endedHistory) {
      const studentId = P[h.student].profileId;
      const teacherId = P[h.teacher].profileId;
      const subjectId = subjectIds[h.subject];
      const exists = await prisma.studentTeacherAssignment.findFirst({
        where: { academyId, studentId, teacherId, subjectId, status: "ENDED" },
        select: { id: true },
      });
      if (!exists) {
        await prisma.studentTeacherAssignment.create({
          data: { academyId, studentId, teacherId, subjectId, status: "ENDED", createdById: admin.id, endedAt: new Date(Date.now() - h.daysAgo * DAY), endedReason: h.reason },
        });
      }
      // The composite FK needs the teacher to teach the subject (already true for the teachers above).
      await prisma.studentSubject.upsert({
        where: { studentId_subjectId: { studentId, subjectId } },
        update: { academyId },
        create: { academyId, studentId, subjectId },
      });
    }

    // =========================================================================
    // Subscriptions + invoices + payment attempts + subscription ledger
    // =========================================================================
    async function upsertInvoice(i: InvoiceSpec) {
      const data = {
        academyId,
        studentId: P[i.student].profileId,
        subscriptionId: i.subscriptionId ?? null,
        amountMinor: BigInt(i.amount),
        currency: i.currency,
        provider: i.provider,
        exchangeRate: i.exchangeRate ?? null,
        packageType: i.type,
        sessionsPurchased: i.sessions,
        status: i.status,
        providerReference: i.ref ?? null,
        paidAt: i.status === "PAID" ? (i.paidAt ?? new Date()) : null,
      };
      await prisma.invoice.upsert({ where: { id: i.id }, update: data, create: { id: i.id, ...data } });
      for (const a of i.attempts) {
        const attempt = {
          invoiceId: i.id,
          provider: i.provider,
          providerReference: a.ref ?? null,
          checkoutUrl: a.checkout ?? null,
          status: a.status,
          rawEventHash: a.hash ?? null,
        };
        await prisma.paymentAttempt.upsert({
          where: { idempotencyKey: a.key },
          update: attempt,
          create: { idempotencyKey: a.key, ...attempt },
        });
      }
    }

    const subOf: Record<string, string> = {};
    for (const s of subSpecs) {
      const periodStartsAt = new Date(Date.now() - s.startDaysAgo * DAY);
      const periodEndsAt = s.type === "PAY_PER_SESSION" ? null : addMonthsUtc(periodStartsAt, 1);
      const studentId = P[s.student].profileId;
      const data = {
        academyId,
        studentId,
        packageType: s.type,
        sessionsPurchased: s.sessions,
        totalAmountMinor: BigInt(s.amountMinor),
        currency: s.currency,
        periodStartsAt,
        periodEndsAt,
        status: s.status,
      };
      await prisma.subscription.upsert({ where: { id: s.id }, update: data, create: { id: s.id, ...data } });
      subOf[s.student] = s.id;

      if (s.invoice) {
        await upsertInvoice({
          id: s.invoice.id,
          student: s.student,
          subscriptionId: s.id,
          provider: s.invoice.provider,
          currency: s.currency,
          amount: s.amountMinor,
          status: "PAID",
          type: s.type,
          sessions: s.sessions,
          exchangeRate: s.invoice.exchangeRate,
          ref: s.invoice.ref,
          paidAt: periodStartsAt,
          attempts: [{ key: `demo-paid-${s.invoice.id}`, status: "SUCCEEDED", ref: s.invoice.ref, hash: sha(`demo-webhook-${s.invoice.id}`) }],
        });
      }

      // Ledger is append-only (trigger). Re-seeding resets it the same way the original seed did.
      await prisma.$transaction(
        [
          prisma.$executeRawUnsafe("ALTER TABLE subscription_ledger DISABLE TRIGGER subscription_ledger_append_only"),
          prisma.subscriptionLedger.deleteMany({ where: { subscriptionId: s.id } }),
          prisma.$executeRawUnsafe("ALTER TABLE subscription_ledger ENABLE TRIGGER subscription_ledger_append_only"),
        ],
        { timeout: 30_000, maxWait: 15_000 }
      );
      if (s.sessions !== 0) {
        await prisma.subscriptionLedger.create({
          data: { academyId, subscriptionId: s.id, invoiceId: s.invoice?.id ?? null, entryType: "INITIAL_PURCHASE", sessionsDelta: s.sessions },
        });
      }
      for (const extra of s.extraLedger ?? []) {
        await prisma.subscriptionLedger.create({
          data: { academyId, subscriptionId: s.id, entryType: extra.entryType, sessionsDelta: extra.delta },
        });
      }
    }
    for (const inv of standaloneInvoices) await upsertInvoice(inv);

    // =========================================================================
    // Recurrence series
    // =========================================================================
    const seriesSpecs = [
      { id: SER(1), teacher: "demo_teacher_quran", subject: "demo-quran", type: "PRIVATE" as const, startDay: 3, hour: 17, totalWeeks: 8, generated: 2, status: "ACTIVE" as const, students: ["demo_student_series"], zoom: "https://zoom.us/j/7000000332", note: "Generated only up to the available credit; continues when credit arrives." },
      { id: SER(2), teacher: "demo_teacher_math", subject: "demo-fiqh", type: "PRIVATE" as const, startDay: -40, hour: 14, totalWeeks: 4, generated: 3, status: "COMPLETED" as const, students: ["demo_student_exhausted"], zoom: "https://zoom.us/j/7000000310", note: "All weeks generated and settled." },
      { id: SER(3), teacher: "demo_teacher_multi", subject: "demo-english", type: "GROUP" as const, startDay: 6, hour: 17, totalWeeks: 6, generated: -1, status: "PAUSED" as const, students: ["demo_student_payper", "demo_student_adult", "demo_student_annual"], zoom: "https://zoom.us/j/7000000340", note: "Paused: not every student in the group has credit for the next week." },
      { id: SER(4), teacher: "demo_teacher_lang", subject: "demo-arabic", type: "PRIVATE" as const, startDay: 7, hour: 17, totalWeeks: 5, generated: -1, status: "CANCELLED" as const, students: ["demo_student_cancelled"], zoom: "https://zoom.us/j/7000000341", note: "Cancelled together with the subscription." },
    ];
    for (const s of seriesSpecs) {
      // Canonical rule shape — the same keys lib/schedules/series.ts reads when the
      // worker extends the series (scheduledStart/scheduledEnd/studentIds/zoomJoinUrl).
      // Legacy keys (weekday/local_time/…) made extendDueSeries fail with
      // "Invalid time value" (fixed 2026-10-18).
      const anchorStart = cairoWallClock(s.startDay, s.hour);
      const anchorEnd = plus(anchorStart, 60);
      const startInstant = cairoWallClock(s.startDay, 12);
      const data = {
        academyId,
        teacherId: P[s.teacher].profileId,
        subjectId: subjectIds[s.subject],
        sessionType: s.type,
        recurrenceRule: {
          scheduledStart: anchorStart.toISOString(),
          scheduledEnd: anchorEnd.toISOString(),
          zoomJoinUrl: s.zoom,
          zoomHostUrl: null,
          studentIds: s.students.map((u) => P[u].profileId),
          note: s.note,
        } as Prisma.InputJsonValue,
        timezone: demoTimezone,
        startDate: startInstant,
        totalWeeks: s.totalWeeks,
        generatedThroughWeek: s.generated,
        status: s.status,
        createdById: admin.id,
      };
      await prisma.recurrenceSeries.upsert({ where: { id: s.id }, update: data, create: { id: s.id, ...data } });
    }

    // =========================================================================
    // Sessions (+ session students, reservations, reports, ledger deductions)
    // =========================================================================
    const s603Start = new Date(Date.now() + 2 * DAY);
    s603Start.setUTCHours(16, 0, 0, 0);

    const sessionSpecs: SessionSpec[] = [
      // ---- settled history (reports ARCHIVED, credit consumed) ----
      { id: S(301), teacher: "demo_teacher_quran", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(-20, 17), status: "COMPLETED", zoom: "https://zoom.us/j/7000000301", students: [{ u: "demo_student_credit_many", attendance: "ATTENDED", reservation: "CONSUMED", report: rep({ remark: "excellent", summary: "تمت مراجعة سورة البقرة مع تحسين المخارج والتجويد.", homework: "حفظ الصفحة 12 ومراجعتها يومياً.", attachments: [{ name: "recitation-notes.pdf", mime: "application/pdf", size: 184_320 }, { name: "tajweed-board.png", mime: "image/png", size: 92_160 }] }) }] },
      { id: S(302), teacher: "demo_teacher_quran", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(-18, 17), status: "COMPLETED", zoom: "https://zoom.us/j/7000000302", students: [{ u: "demo_student_credit_many", attendance: "ATTENDED", reservation: "CONSUMED", report: rep({ by: "supervisor", remark: "good", summary: "تسميع الصفحة 12 وتصحيح أخطاء المدود.", homework: "حفظ الصفحة 13.", extra: { minutes: 15, status: "APPROVED" } }) }] },
      { id: S(303), teacher: "demo_teacher_multi", subject: "demo-english", type: "PRIVATE", start: cairoWallClock(-15, 18), status: "COMPLETED", zoom: "https://zoom.us/j/7000000303", students: [{ u: "demo_student_annual", attendance: "ATTENDED", reservation: "CONSUMED", report: rep({ remark: "good", summary: "Present simple vs present continuous with speaking drills.", homework: "Write ten sentences using both tenses." }) }] },
      { id: S(304), teacher: "demo_teacher_multi", subject: "demo-english", type: "PRIVATE", start: cairoWallClock(-14, 18), status: "MISSED", zoom: "https://zoom.us/j/7000000304", students: [{ u: "demo_student_annual", attendance: "STUDENT_ABSENT", reservation: "RELEASED", report: repAbsent() }] },
      { id: S(305), teacher: "demo_teacher_quran", subject: "demo-quran", type: "GROUP", start: cairoWallClock(-12, 16), status: "COMPLETED", zoom: "https://zoom.us/j/7000000305", host: true, students: [
        { u: "demo_student_group_a", attendance: "ATTENDED", reservation: "CONSUMED", report: rep({ remark: "good", summary: "حلقة جماعية: مراجعة جزء عمّ مع تصحيح فردي.", homework: "مراجعة سورة النبأ." }) },
        { u: "demo_student_group_b", attendance: "STUDENT_ABSENT", reservation: "RELEASED", report: repAbsent() },
      ] },
      { id: S(306), teacher: "demo_teacher_math", subject: "demo-math", type: "PRIVATE", start: cairoWallClock(-9, 19), status: "COMPLETED", zoom: "https://zoom.us/j/7000000306", students: [{ u: "demo_student_usd", attendance: "ATTENDED", reservation: "CONSUMED", report: rep({ remark: "excellent", summary: "Fractions: addition and subtraction with unlike denominators.", homework: "Worksheet 4, problems 1-10.", attachments: [{ name: "worksheet-4.pdf", mime: "application/pdf", size: 220_000 }] }) }] },
      { id: S(307), teacher: "demo_teacher_multi", subject: "demo-english", type: "PRIVATE", start: cairoWallClock(-8, 19), status: "COMPLETED", zoom: "https://zoom.us/j/7000000307", students: [{ u: "demo_student_payper", attendance: "ATTENDED", reservation: "CONSUMED", report: rep({ remark: "acceptable", summary: "Vocabulary: travel and directions.", homework: "Memorize the 20 new words.", notes: "Needs more speaking practice." }) }] },
      { id: S(308), teacher: "demo_teacher_lang", subject: "demo-arabic", type: "PRIVATE", start: cairoWallClock(-7, 15), status: "COMPLETED", zoom: "https://zoom.us/j/7000000308", students: [{ u: "demo_student_adult", attendance: "ATTENDED", reservation: "CONSUMED", report: rep({ remark: "good", summary: "قراءة نص وتحليل الجملة الاسمية والفعلية.", homework: "كتابة فقرة من خمسة أسطر.", extra: { minutes: 20, status: "REJECTED" } }) }] },
      { id: S(309), teacher: "demo_teacher_multi", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(-6, 17), status: "MISSED", zoom: "https://zoom.us/j/7000000309", students: [{ u: "demo_student_missed", attendance: "STUDENT_ABSENT", reservation: "RELEASED", report: repAbsent({ by: "supervisor" }) }] },
      // exhausted plan: 4 settled sessions in a COMPLETED series
      ...[0, 1, 2, 3].map((week): SessionSpec => ({
        id: S(310 + week), teacher: "demo_teacher_math", subject: "demo-fiqh", type: "PRIVATE", start: cairoWallClock(-40 + week * 7, 14), status: "COMPLETED",
        zoom: "https://zoom.us/j/7000000310", series: { id: SER(2), week },
        students: [{ u: "demo_student_exhausted", attendance: "ATTENDED", reservation: "CONSUMED", report: rep({ remark: week === 3 ? "excellent" : "good", summary: `أحكام الطهارة — الأسبوع ${week + 1}.`, homework: "مراجعة الملخص وحل أسئلة الدرس." }) }],
      })),
      // expired plan: 3 settled sessions, the remaining 5 expired (EXPIRY ledger row)
      ...[0, 1, 2].map((i): SessionSpec => ({
        id: S(314 + i), teacher: "demo_teacher_multi", subject: "demo-english", type: "PRIVATE", start: cairoWallClock(-50 + i * 7, 15), status: "COMPLETED",
        zoom: "https://zoom.us/j/7000000314",
        students: [{ u: "demo_student_expired", attendance: "ATTENDED", reservation: "CONSUMED", report: rep({ remark: "good", summary: `Grammar lesson ${i + 1}: past tenses.`, homework: "Complete the exercises." }) }],
      })),

      // ---- review pipeline: submitted / rejected / approved-not-settled / missing ----
      { id: S(317), teacher: "demo_teacher_math", subject: "demo-math", type: "PRIVATE", start: cairoWallClock(-3, 16), status: "SCHEDULED", zoom: "https://zoom.us/j/7000000317", students: [{ u: "demo_student_usd", attendance: "PENDING", reservation: "RESERVED", report: rep({ status: "SUBMITTED", remark: "good", summary: "Decimals and percentages.", homework: "Worksheet 5.", extra: { minutes: 10, status: "PENDING" }, events: { late_entry_minutes: 5 } }) }] },
      { id: S(318), teacher: "demo_teacher_multi", subject: "demo-english", type: "PRIVATE", start: cairoWallClock(-2, 14), status: "SCHEDULED", zoom: "https://zoom.us/j/7000000318", students: [{ u: "demo_student_payper", attendance: "PENDING", reservation: "RESERVED", report: repAbsent({ status: "SUBMITTED" }) }] },
      { id: S(319), teacher: "demo_teacher_lang", subject: "demo-arabic", type: "PRIVATE", start: cairoWallClock(-2, 20), status: "SCHEDULED", zoom: "https://zoom.us/j/7000000319", students: [{ u: "demo_student_adult", attendance: "PENDING", reservation: "RESERVED", report: rep({ status: "REJECTED", by: "supervisor", remark: "acceptable", summary: "قواعد الإملاء.", homework: "تمارين الإملاء.", rejection: "الملخص مختصر جداً، يرجى ذكر الأخطاء التي تم تصحيحها." }) }] },
      { id: S(320), teacher: "demo_teacher_multi", subject: "demo-english", type: "PRIVATE", start: cairoWallClock(-1, 13), status: "SCHEDULED", zoom: "https://zoom.us/j/7000000320", students: [{ u: "demo_student_annual", attendance: "ATTENDED", reservation: "RESERVED", report: rep({ status: "APPROVED", by: "supervisor", remark: "excellent", summary: "Role-play: ordering at a restaurant.", homework: "Record a 2-minute dialogue.", attachments: [{ name: "dialogue-script.pdf", mime: "application/pdf", size: 64_000 }] }) }] },
      { id: S(321), teacher: "demo_teacher_lang", subject: "demo-arabic", type: "PRIVATE", start: cairoWallClock(-1, 21), status: "SCHEDULED", zoom: "https://zoom.us/j/7000000321", students: [{ u: "demo_student_adult", attendance: "PENDING", reservation: "RESERVED" }] },

      // ---- legacy scenarios (ids preserved) ----
      { id: L("603"), teacher: "demo_teacher", subject: "demo-quran", type: "PRIVATE", start: s603Start, status: "SCHEDULED", zoom: "https://zoom.us/j/7000000603", students: [{ u: "demo_student", attendance: "PENDING", reservation: "RESERVED" }] },
      { id: L("606"), teacher: "demo_teacher_quran", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(1, 18), status: "SCHEDULED", zoom: "https://zoom.us/j/7001112233", students: [{ u: "demo_student_credit_many", attendance: "PENDING", reservation: "RESERVED" }] },
      { id: L("607"), teacher: "demo_teacher_quran", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(-1, 16), status: "CANCELLED", zoom: "https://zoom.us/j/7001112244", cancel: { by: "admin", reason: "Demo cancellation" }, students: [{ u: "demo_student_credit_many", attendance: "PENDING", reservation: "RELEASED" }] },
      { id: L("608"), teacher: "demo_teacher_quran", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(-1, 18), status: "SCHEDULED", zoom: "https://zoom.us/j/7001112255", students: [{ u: "demo_student_group_a", attendance: "PENDING", reservation: "RESERVED" }] },
      { id: L("609"), teacher: "demo_teacher_quran", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(-1, 15), status: "SCHEDULED", zoom: "https://zoom.us/j/7001112266", students: [{ u: "demo_student_group_b", attendance: "ATTENDED", reservation: "RESERVED", report: rep({ status: "APPROVED", remark: "excellent", summary: "تمت مراجعة سورة البقرة مع تحسين المخارج والتجويد.", homework: "حفظ الصفحة 12 ومراجعتها يومياً.", events: { late_entry_minutes: 3 } }) }] },
      { id: L("60a"), teacher: "demo_teacher_quran", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(-1, 10), status: "SCHEDULED", zoom: "https://zoom.us/j/7001112277", students: [{ u: "demo_student_credit_many", attendance: "PENDING", reservation: "RESERVED", report: rep({ status: "REJECTED", remark: "good", summary: "مراجعة أحكام التجويد.", homework: "تسميع الصفحة 10.", rejection: "يرجى توضيح ما أُنجز في الحصة بالتفصيل قبل إعادة الإرسال." }) }] },
      { id: L("60b"), teacher: "demo_teacher_quran", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(-1, 12), status: "SCHEDULED", zoom: "https://zoom.us/j/7001112288", students: [{ u: "demo_student_group_a", attendance: "PENDING", reservation: "RESERVED", report: rep({ status: "SUBMITTED", remark: "good", summary: "حصة تجويد وتلاوة مع تصحيح الأخطاء.", homework: "تسميع الصفحة 14 وتسجيلها.", notes: "الطالب متحمس ويحتاج تمارين إضافية على المدود." }) }] },

      // ---- upcoming ----
      { id: S(330), teacher: "demo_teacher_math", subject: "demo-math", type: "PRIVATE", start: cairoWallClock(1, 20), status: "SCHEDULED", zoom: "https://zoom.us/j/7000000330", host: true, students: [{ u: "demo_student_usd", attendance: "PENDING", reservation: "RESERVED" }] },
      { id: S(331), teacher: "demo_teacher_multi", subject: "demo-english", type: "GROUP", start: cairoWallClock(2, 17), status: "SCHEDULED", zoom: "https://zoom.us/j/7000000331", host: true, students: [
        { u: "demo_student_annual", attendance: "PENDING", reservation: "RESERVED" },
        { u: "demo_student_payper", attendance: "PENDING", reservation: "RESERVED" },
        { u: "demo_student_adult", attendance: "PENDING", reservation: "RESERVED" },
      ] },
      ...[0, 1, 2].map((week): SessionSpec => ({
        id: S(332 + week), teacher: "demo_teacher_quran", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(3 + week * 7, 17), status: "SCHEDULED",
        zoom: "https://zoom.us/j/7000000332", series: { id: SER(1), week },
        students: [{ u: "demo_student_series", attendance: "PENDING", reservation: "RESERVED" }],
      })),
      { id: S(335), teacher: "demo_teacher_quran", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(4, 16), status: "SCHEDULED", zoom: "https://zoom.us/j/7000000335", replacementFor: L("607"), students: [{ u: "demo_student_credit_many", attendance: "PENDING", reservation: "RESERVED" }] },
      { id: S(336), teacher: "demo_teacher_quran", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(5, 18), status: "SCHEDULED", zoom: "https://zoom.us/j/7000000336", students: [{ u: "demo_student_zero", attendance: "PENDING", reservation: null, creditOverride: { by: "supervisor", reason: "Demo: trial-like makeup session approved by the supervisor" } }] },
      { id: S(337), teacher: "demo_teacher_multi", subject: "demo-quran", type: "PRIVATE", start: cairoWallClock(5, 19), status: "SCHEDULED", zoom: "https://zoom.us/j/7000000337", assignmentOverride: { by: "admin", reason: "Demo: student has no active teacher yet" }, students: [{ u: "demo_student_unassigned", attendance: "PENDING", reservation: null, creditOverride: { by: "admin", reason: "Demo: onboarding session, credit pending" } }] },
    ];

    async function ensureReservation(sessionId: string, studentId: string, subscriptionId: string, sessionDate: Date, status: ReservationStatus) {
      const existing = await prisma.sessionReservation.findUnique({
        where: { sessionId_studentId: { sessionId, studentId } },
        select: { id: true, status: true },
      });
      if (existing?.status === status) return;
      if (existing) {
        await prisma.sessionReservation.update({
          where: { id: existing.id },
          data: { status, subscriptionId, releasedAt: status === "RELEASED" ? new Date() : null },
        });
        return;
      }
      if (status === "CONSUMED" || status === "RELEASED") {
        // CONSUMED: the matching SESSION_DEDUCTION is written with the report below.
        // RELEASED: no credit check needed (it frees the credit), and the session date
        // may fall outside the subscription period that reserveCredit looks for.
        await prisma.sessionReservation.create({
          data: { academyId, sessionId, studentId, subscriptionId, status, releasedAt: status === "RELEASED" ? new Date() : null },
        });
        return;
      }
      await prisma.$transaction(
        async (tx) => {
          const ok = await reserveCredit(tx, academyId, studentId, sessionId, sessionDate);
          if (!ok) throw new Error(`Seed reservation failed (no credit) for student ${studentId} in session ${sessionId}`);
        },
        { timeout: 30_000, maxWait: 15_000 }
      );
    }

    /** Created only if missing: archived reports are immutable (re-seeding must not touch them). */
    async function ensureReport(sessionId: string, teacherId: string, studentId: string, sessionEnd: Date, r: ReportSpec) {
      const existing = await prisma.report.findUnique({
        where: { sessionId_studentId_reportType: { sessionId, studentId, reportType: "SESSION_COMPLETION_REPORT" } },
        select: { id: true },
      });
      if (existing) return existing.id;

      const reviewer = by(r.by ?? "admin");
      const decidedAt = plus(sessionEnd, 90);
      const approved = r.status === "APPROVED" || r.status === "ARCHIVED";
      const archived = r.status === "ARCHIVED";
      const extra = r.extra;
      const created = await prisma.report.create({
        data: {
          academyId,
          sessionId,
          studentId,
          teacherId,
          reportType: "SESSION_COMPLETION_REPORT",
          status: r.status,
          attendanceOutcome: r.outcome,
          classRemark: r.remark,
          summary: r.summary,
          homework: r.homework,
          notes: r.notes ?? null,
          operationalEvents: r.events as Prisma.InputJsonValue | undefined,
          extraTimeMinutes: extra?.minutes ?? 0,
          extraTimeStatus: extra?.status ?? "NONE",
          extraTimeReviewedById: extra && extra.status !== "PENDING" ? reviewer : null,
          extraTimeReviewedAt: extra && extra.status !== "PENDING" ? decidedAt : null,
          submittedAt: plus(sessionEnd, 30),
          rejectionReason: r.status === "REJECTED" ? (r.rejection ?? "Needs more detail.") : null,
          rejectedById: r.status === "REJECTED" ? reviewer : null,
          rejectedAt: r.status === "REJECTED" ? decidedAt : null,
          approvedById: approved ? reviewer : null,
          approvedAt: approved ? decidedAt : null,
          settledAt: archived ? decidedAt : null,
          archivedAt: archived ? decidedAt : null,
        },
        select: { id: true },
      });
      for (const a of r.attachments ?? []) {
        await prisma.reportAttachment.create({
          data: {
            academyId,
            reportId: created.id,
            // Placeholder storage path: no real file is uploaded to Supabase Storage by the seed.
            filePath: `reports/${created.id}/${a.name}`,
            mimeType: a.mime,
            sizeBytes: BigInt(a.size),
            originalName: a.name,
          },
        });
      }
      return created.id;
    }

    const startOf: Record<string, Date> = {};
    for (const s of sessionSpecs) {
      const minutes = s.minutes ?? 60;
      const end = plus(s.start, minutes);
      startOf[s.id] = s.start;
      const teacherId = P[s.teacher].profileId;
      const data = {
        academyId,
        teacherId,
        subjectId: subjectIds[s.subject],
        sessionType: s.type,
        scheduledStart: s.start,
        scheduledEnd: end,
        durationMinutes: minutes,
        timezone: demoTimezone,
        zoomJoinUrl: s.zoom,
        zoomHostUrl: s.host ? `${s.zoom.replace("/j/", "/s/")}?role=host` : null,
        recurrenceGroupId: s.series?.id ?? null,
        recurrenceWeekIndex: s.series?.week ?? null,
        replacementForSessionId: s.replacementFor ?? null,
        cancellationReason: s.cancel?.reason ?? null,
        cancelledById: s.cancel ? by(s.cancel.by) : null,
        assignmentOverriddenById: s.assignmentOverride ? by(s.assignmentOverride.by) : null,
        assignmentOverrideReason: s.assignmentOverride?.reason ?? null,
        createdById: admin.id,
        status: s.status,
      };
      await prisma.session.upsert({ where: { id: s.id }, update: data, create: { id: s.id, ...data } });

      for (const st of s.students) {
        const studentId = P[st.u].profileId;
        const subscriptionId = subOf[st.u];
        const override = st.creditOverride;
        await prisma.sessionStudent.upsert({
          where: { sessionId_studentId: { sessionId: s.id, studentId } },
          update: { attendanceStatus: st.attendance, overriddenById: override ? by(override.by) : null, overrideReason: override?.reason ?? null },
          create: { sessionId: s.id, studentId, attendanceStatus: st.attendance, overriddenById: override ? by(override.by) : null, overrideReason: override?.reason ?? null },
        });
        if (st.reservation) {
          if (!subscriptionId) throw new Error(`No subscription for ${st.u}`);
          await ensureReservation(s.id, studentId, subscriptionId, s.start, st.reservation);
        }
        if (st.report) {
          const reportId = await ensureReport(s.id, teacherId, studentId, end, st.report);
          if (st.report.status === "ARCHIVED" && st.report.outcome === "ATTENDED") {
            if (!subscriptionId) throw new Error(`No subscription for ${st.u}`);
            await prisma.subscriptionLedger.create({
              data: { academyId, subscriptionId, sessionId: s.id, reportId, entryType: "SESSION_DEDUCTION", sessionsDelta: -1 },
            });
          }
        }
      }
    }

    // Late-report red marks (sessions with no report after the grace window).
    for (const sessionId of [L("608"), S(321)]) {
      const teacherId = sessionSpecs.find((x) => x.id === sessionId)!.teacher;
      await prisma.teacherFlag.upsert({
        where: { sessionId_flagType: { sessionId, flagType: "LATE_REPORT" } },
        update: { teacherId: P[teacherId].profileId },
        create: { academyId, teacherId: P[teacherId].profileId, sessionId, flagType: "LATE_REPORT" },
      });
    }

    // =========================================================================
    // Phase 6 payroll: effective-dated rates + SESSION_CREDIT rows for the
    // settled history. payroll_ledger is append-only, so every write below is
    // guarded by an existence check — re-seeding never violates the partial
    // unique index and never duplicates money rows.
    // =========================================================================
    const teacherRateSpecs: { teacher: string; hourlyRateMinor: number; currency: Currency }[] = [
      { teacher: "demo_teacher_quran", hourlyRateMinor: 9000, currency: "EGP" },
      { teacher: "demo_teacher_math", hourlyRateMinor: 11000, currency: "EGP" },
      { teacher: "demo_teacher_multi", hourlyRateMinor: 10500, currency: "EGP" },
      { teacher: "demo_teacher_lang", hourlyRateMinor: 9500, currency: "EGP" },
      { teacher: "demo_teacher", hourlyRateMinor: 9000, currency: "EGP" },
    ];
    for (const spec of teacherRateSpecs) {
      const teacherId = P[spec.teacher].profileId;
      const existingRate = await prisma.teacherRate.findFirst({ where: { teacherId }, select: { id: true } });
      if (!existingRate) {
        await prisma.teacherRate.create({
          data: {
            academyId,
            teacherId,
            hourlyRateMinor: spec.hourlyRateMinor,
            currency: spec.currency,
            effectiveFrom: new Date(Date.now() - 120 * DAY),
            createdById: admin.id,
          },
        });
      }
    }
    const rateByTeacher = new Map(
      (await prisma.teacherRate.findMany({ where: { academyId }, orderBy: { effectiveFrom: "asc" }, select: { id: true, teacherId: true, hourlyRateMinor: true, currency: true } })).map((rate) => [rate.teacherId, rate]),
    );
    const settledReports = await prisma.report.findMany({
      where: { academyId, status: "ARCHIVED", attendanceOutcome: "ATTENDED" },
      select: { id: true, sessionId: true, teacherId: true, session: { select: { scheduledStart: true, durationMinutes: true } } },
    });
    for (const report of settledReports) {
      const existingCredit = await prisma.payrollLedger.findFirst({
        where: { academyId, sessionId: report.sessionId, entryType: "SESSION_CREDIT" },
        select: { id: true },
      });
      if (existingCredit) continue;
      const rate = rateByTeacher.get(report.teacherId);
      if (!rate) continue;
      const minutes = report.session.durationMinutes;
      const amountMinor = Math.floor((minutes * rate.hourlyRateMinor + 30) / 60);
      await prisma.payrollLedger.create({
        data: {
          academyId,
          teacherId: report.teacherId,
          sessionId: report.sessionId,
          reportId: report.id,
          teacherRateId: rate.id,
          entryType: "SESSION_CREDIT",
          amountMinor,
          currency: rate.currency,
          minutesCredited: minutes,
          hourlyRateSnapshotMinor: rate.hourlyRateMinor,
        },
      });
    }
    // One demo bonus + one demo payout for the quran teacher (dedup by reason;
    // created_by = the Admin so the audit distinction is visible).
    const quranTeacherId = P["demo_teacher_quran"].profileId;
    const bonusReason = "Demo: student-progress bonus (approved by Admin)";
    const bonusExists = await prisma.payrollLedger.findFirst({ where: { academyId, teacherId: quranTeacherId, reason: bonusReason }, select: { id: true } });
    if (!bonusExists) {
      await prisma.payrollLedger.create({
        data: {
          academyId,
          teacherId: quranTeacherId,
          entryType: "ADMIN_ADJUSTMENT",
          amountMinor: 5000,
          currency: "EGP",
          reason: bonusReason,
          createdById: admin.id,
        },
      });
    }
    const payoutReason = "Demo: January monthly payout (bank transfer reference kept offline)";
    const payoutExists = await prisma.payrollLedger.findFirst({ where: { academyId, teacherId: quranTeacherId, reason: payoutReason }, select: { id: true } });
    if (!payoutExists) {
      await prisma.payrollLedger.create({
        data: {
          academyId,
          teacherId: quranTeacherId,
          entryType: "DISBURSEMENT",
          amountMinor: -20000,
          currency: "EGP",
          reason: payoutReason,
          createdById: admin.id,
        },
      });
    }

    // =========================================================================
    // Join clicks + link audits
    // =========================================================================
    await prisma.sessionJoinClick.upsert({
      where: { id: L("604") },
      update: { sessionId: L("603"), userId: P["demo_student"].userId },
      create: { id: L("604"), sessionId: L("603"), userId: P["demo_student"].userId },
    });
    const clicks: { n: number; session: string; user: string; afterMin: number }[] = [
      { n: 1, session: S(301), user: "demo_teacher_quran", afterMin: -1 },
      { n: 2, session: S(301), user: "demo_student_credit_many", afterMin: 3 },
      { n: 3, session: S(305), user: "demo_teacher_quran", afterMin: 0 },
      { n: 4, session: S(305), user: "demo_student_group_a", afterMin: 2 },
      { n: 5, session: S(306), user: "demo_teacher_math", afterMin: 0 },
      { n: 6, session: S(306), user: "demo_student_usd", afterMin: 5 },
      { n: 7, session: S(308), user: "demo_student_adult", afterMin: 1 },
      { n: 8, session: S(320), user: "demo_teacher_multi", afterMin: -2 },
      { n: 9, session: S(320), user: "demo_student_annual", afterMin: 4 },
    ];
    for (const c of clicks) {
      const clickedAt = plus(startOf[c.session], c.afterMin);
      await prisma.sessionJoinClick.upsert({
        where: { id: CLK(c.n) },
        update: { sessionId: c.session, userId: P[c.user].userId, clickedAt },
        create: { id: CLK(c.n), sessionId: c.session, userId: P[c.user].userId, clickedAt },
      });
    }

    const audits: { n: number; series?: string; session?: string; who: Who; source: string; join: boolean; host: boolean }[] = [
      { n: 1, series: SER(1), who: "admin", source: "series_create", join: true, host: false },
      { n: 2, series: SER(1), who: "supervisor", source: "series_link_edit", join: true, host: true },
      { n: 3, session: S(331), who: "admin", source: "session_link_edit", join: true, host: false },
      { n: 4, session: S(330), who: "supervisor", source: "session_create", join: true, host: true },
      { n: 5, series: SER(3), who: "admin", source: "series_create", join: true, host: false },
    ];
    // `source` is limited by a CHECK constraint whose values live only in the migrations,
    // so read the allowed values from the database itself instead of guessing them.
    const sourceConstraint = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'session_link_audits_source_check'`;
    const allowedSources = [...(sourceConstraint[0]?.def ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    console.log(`session_link_audits.source allowed values: ${allowedSources.join(", ") || "(could not read constraint)"}`);

    if (allowedSources.length === 0) {
      console.warn("Skipping session link audits: could not read the allowed `source` values.");
    } else {
      for (const [index, a] of audits.entries()) {
        const hint = a.series ? "series" : "session";
        const source = allowedSources.find((value) => value.includes(hint)) ?? allowedSources[index % allowedSources.length];
        const data = {
          academyId,
          seriesId: a.series ?? null,
          sessionId: a.session ?? null,
          changedById: by(a.who),
          source,
          joinUrlChanged: a.join,
          hostUrlChanged: a.host,
        };
        await prisma.sessionLinkAudit.upsert({ where: { id: AUD(a.n) }, update: data, create: { id: AUD(a.n), ...data } });
      }
    }

    // =========================================================================
    // Outage / change requests
    // =========================================================================
    const sessionRequests = [
      { n: 1, session: L("606"), by: "demo_student_credit_many", reason: "عندي ظرف طارئ ولن أستطيع الحضور.", status: "PENDING" as const },
      { n: 2, session: L("607"), by: "demo_teacher_quran", reason: "ظرف صحي طارئ للمعلمة.", status: "APPROVED" as const, reviewer: "admin" as Who, replacement: S(335) },
      { n: 3, session: S(331), by: "demo_guardian_2", reason: "Family trip — cannot attend this group session.", status: "REJECTED" as const, reviewer: "supervisor" as Who },
      { n: 4, session: S(330), by: "demo_teacher_math", reason: "Power outage expected in my area at that time.", status: "PENDING" as const },
    ];
    for (const r of sessionRequests) {
      const decided = r.status !== "PENDING";
      const data = {
        academyId,
        sessionId: r.session,
        requestedById: P[r.by].userId,
        reason: r.reason,
        status: r.status,
        reviewedById: decided ? by(r.reviewer!) : null,
        reviewedAt: decided ? new Date(Date.now() - DAY) : null,
        replacementSessionId: r.replacement ?? null,
      };
      await prisma.sessionRequest.upsert({ where: { id: REQ(r.n) }, update: data, create: { id: REQ(r.n), ...data } });
    }

    const changeRequests = [
      { n: 1, session: L("606"), teacher: "demo_teacher_quran", reason: "تعارض مع موعد آخر.", proposed: "نقل الحصة إلى الساعة 19:00 في نفس اليوم.", status: "PENDING" as const },
      { n: 2, session: S(331), teacher: "demo_teacher_multi", reason: "Group needs more speaking time.", proposed: "Extend the group session by 30 minutes.", status: "APPROVED" as const, reviewer: "admin" as Who },
      { n: 3, session: S(330), teacher: "demo_teacher_math", reason: "Class overlaps with another commitment.", proposed: "Move to the next day, same time.", status: "REJECTED" as const, reviewer: "supervisor" as Who },
    ];
    for (const c of changeRequests) {
      const decided = c.status !== "PENDING";
      const data = {
        academyId,
        sessionId: c.session,
        teacherId: P[c.teacher].profileId,
        reason: c.reason,
        proposedChange: c.proposed,
        status: c.status,
        reviewedById: decided ? by(c.reviewer!) : null,
        reviewedAt: decided ? new Date(Date.now() - DAY) : null,
      };
      await prisma.sessionChangeRequest.upsert({ where: { id: CHG(c.n) }, update: data, create: { id: CHG(c.n), ...data } });
    }

    // =========================================================================
    // Applications (+ created-records for approved ones)
    // =========================================================================
    const applications: {
      id: string; type: "GUARDIAN" | "STUDENT" | "TEACHER"; phone: string; email?: string; details: Prisma.InputJsonValue;
      status: "NEW" | "REVIEWED" | "APPROVED" | "REJECTED"; reviewedBy?: Who; approvedBy?: Who; approvedUser?: string; rejection?: string; records?: string[];
    }[] = [
      { id: L("605"), type: "STUDENT", phone: "+201000000605", email: "demo.student@example.test", status: "NEW", details: { full_name: "Demo Applicant", phone_whatsapp: "+201000000605", date_of_birth: "2012-01-01", subjects: ["demo-quran"], level: "beginner" } },
      { id: APP(1), type: "GUARDIAN", phone: "+201000000701", email: "new.guardian@example.test", status: "NEW", details: { full_name: "New Guardian Applicant", phone_whatsapp: "+201000000701", children_count: 2, preferred_subjects: ["demo-arabic", "demo-math"] } },
      { id: APP(2), type: "TEACHER", phone: "+201000000702", status: "NEW", details: { full_name: "New Teacher Applicant", phone_whatsapp: "+201000000702", subjects: ["demo-quran"], experience_years: 5, available_hours: "evenings" } },
      { id: APP(3), type: "STUDENT", phone: "+201000000703", status: "REVIEWED", reviewedBy: "supervisor", details: { full_name: "Reviewed Student Applicant", phone_whatsapp: "+201000000703", date_of_birth: "2010-05-12", subjects: ["demo-english"], level: "intermediate", guardian_name: "Reviewed Guardian", guardian_phone: "+201000000713", guardian_relationship: "FATHER" } },
      { id: APP(4), type: "GUARDIAN", phone: "+201000000105", status: "APPROVED", reviewedBy: "supervisor", approvedBy: "admin", approvedUser: "demo_guardian_5", records: ["demo_guardian_5"], details: { full_name: "Demo Guardian Five", phone_whatsapp: "+201000000105", children_count: 2, preferred_subjects: ["demo-quran"] } },
      { id: APP(5), type: "STUDENT", phone: "+201000001017", status: "APPROVED", reviewedBy: "admin", approvedBy: "admin", approvedUser: "demo_student_credit_big", records: ["demo_student_credit_big"], details: { full_name: "Demo Student Credit Big", phone_whatsapp: "+201000001017", date_of_birth: "2013-03-03", subjects: ["demo-quran"], level: "beginner", guardian_name: "Demo Guardian Five", guardian_phone: "+201000000105", guardian_relationship: "MOTHER" } },
      { id: APP(6), type: "TEACHER", phone: "+201000000305", status: "APPROVED", reviewedBy: "supervisor", approvedBy: "admin", approvedUser: "demo_teacher_math", records: ["demo_teacher_math"], details: { full_name: "Demo Math Teacher", phone_whatsapp: "+201000000305", subjects: ["demo-math", "demo-fiqh"], experience_years: 8 } },
      { id: APP(7), type: "STUDENT", phone: "+201000000707", status: "REJECTED", reviewedBy: "admin", rejection: "بيانات ولي الأمر غير مكتملة، يرجى إعادة التقديم.", details: { full_name: "Rejected Applicant", phone_whatsapp: "+201000000707", date_of_birth: "2011-09-09", subjects: ["demo-math"], level: "beginner" } },
    ];
    for (const a of applications) {
      const reviewed = a.status !== "NEW";
      const approved = a.status === "APPROVED";
      const data = {
        academyId,
        applicationType: a.type,
        contactPhone: a.phone,
        contactEmail: a.email ?? null,
        details: a.details,
        status: a.status,
        reviewedById: reviewed && a.reviewedBy ? by(a.reviewedBy) : null,
        reviewedAt: reviewed ? new Date(Date.now() - 3 * DAY) : null,
        approvedById: approved && a.approvedBy ? by(a.approvedBy) : null,
        approvedAt: approved ? new Date(Date.now() - 2 * DAY) : null,
        approvedUserId: approved && a.approvedUser ? P[a.approvedUser].userId : null,
        rejectionReason: a.rejection ?? null,
      };
      await prisma.application.upsert({ where: { id: a.id }, update: data, create: { id: a.id, ...data } });
    }
    await prisma.applicationRecord.deleteMany({ where: { applicationId: L("605") } });
    for (const a of applications) {
      for (const username of a.records ?? []) {
        await prisma.applicationRecord.upsert({
          where: { applicationId_userId: { applicationId: a.id, userId: P[username].userId } },
          update: { role: roleOf[username] },
          create: { applicationId: a.id, userId: P[username].userId, role: roleOf[username] },
        });
      }
    }

    // =========================================================================
    // Notification jobs
    // =========================================================================
    // Reminder (2h before) + start-link jobs for every upcoming scheduled session.
    for (const s of sessionSpecs) {
      if (s.status !== "SCHEDULED" || s.start.getTime() < Date.now()) continue;
      const studentUserIds = s.students.map((st) => P[st.u].userId);
      const guardianUserIds = [...new Set(
        s.students
          .map((st) => studentSpecs.find((x) => x.username === st.u)?.guardian)
          .filter((g): g is string => Boolean(g))
          .map((g) => P[g].userId)
      )];
      await enqueueSessionJobs(prisma, academyId, s.id, s.start, P[s.teacher].userId, studentUserIds, guardianUserIds);
    }

    const jobs: { key: string; user: string; kind: string; session?: string; at: Date; status: "PENDING" | "PROCESSING" | "SENT" | "FAILED" | "CANCELLED"; attempts?: number; error?: string }[] = [
      { key: "demo:report-request:301", user: "demo_teacher_quran", kind: "REPORT_REQUEST", session: S(301), at: plus(startOf[S(301)], 60), status: "SENT", attempts: 1 },
      { key: "demo:report-approved:301:guardian", user: "demo_guardian", kind: "REPORT_APPROVED", session: S(301), at: plus(startOf[S(301)], 150), status: "SENT", attempts: 1 },
      { key: "demo:report-request:608", user: "demo_teacher_quran", kind: "REPORT_REQUEST", session: L("608"), at: plus(startOf[L("608")], 60), status: "SENT", attempts: 1 },
      { key: "demo:report-reminder:608", user: "demo_teacher_quran", kind: "REPORT_REMINDER", session: L("608"), at: plus(startOf[L("608")], 75), status: "SENT", attempts: 1 },
      { key: "demo:report-red-mark:608", user: "demo_teacher_quran", kind: "REPORT_RED_MARK", session: L("608"), at: plus(startOf[L("608")], 90), status: "SENT", attempts: 1 },
      { key: "demo:report-request:60b", user: "demo_teacher_quran", kind: "REPORT_REQUEST", session: L("60b"), at: plus(startOf[L("60b")], 60), status: "SENT", attempts: 1 },
      { key: "demo:report-request:321", user: "demo_teacher_lang", kind: "REPORT_REQUEST", session: S(321), at: plus(startOf[S(321)], 60), status: "PROCESSING", attempts: 1 },
      { key: "demo:payment-receipt:12", user: "demo_guardian_2", kind: "PAYMENT_RECEIPT", at: new Date(Date.now() - 10 * DAY), status: "SENT", attempts: 1 },
      { key: "demo:renewal-reminder:609", user: "demo_guardian", kind: "RENEWAL_REMINDER", at: new Date(Date.now() + 5 * DAY), status: "PENDING" },
      { key: "demo:renewal-failed:payper", user: "demo_guardian_3", kind: "RENEWAL_FAILED", at: new Date(Date.now() - 2 * DAY), status: "FAILED", attempts: 3, error: "OpenWA session disconnected" },
      { key: "demo:credentials:adult", user: "demo_student_adult", kind: "CREDENTIALS", at: new Date(Date.now() - 12 * DAY), status: "SENT", attempts: 1 },
      { key: "demo:credentials:math-teacher", user: "demo_teacher_math", kind: "CREDENTIALS", at: new Date(Date.now() - 12 * DAY), status: "FAILED", attempts: 2, error: "Send failed (redacted)" },
      { key: "demo:reminder-cancelled:607", user: "demo_student_credit_many", kind: "SESSION_REMINDER", session: L("607"), at: plus(startOf[L("607")], -120), status: "CANCELLED" },
    ];
    for (const j of jobs) {
      const data = {
        academyId,
        sessionId: j.session ?? null,
        recipientUserId: P[j.user].userId,
        kind: j.kind,
        scheduledFor: j.at,
        status: j.status,
        attempts: j.attempts ?? 0,
        lastError: j.error ?? null,
        sentAt: j.status === "SENT" ? j.at : null,
      };
      await prisma.notificationJob.upsert({ where: { dedupKey: j.key }, update: data, create: { dedupKey: j.key, ...data } });
    }

    // =========================================================================
    // Summary
    // =========================================================================
    console.log("\nDemo students (credit = ledger sum − active reservations):");
    for (const s of studentSpecs) {
      const studentId = P[s.username].profileId;
      const ledger = await prisma.subscriptionLedger.findMany({ where: { subscription: { studentId } }, select: { sessionsDelta: true } });
      const reserved = await prisma.sessionReservation.count({ where: { studentId, status: "RESERVED" } });
      const balance = ledger.reduce((total, e) => total + e.sessionsDelta, 0) - reserved;
      const sub = subSpecs.find((x) => x.student === s.username);
      console.log(
        `${s.username.padEnd(28)} | credit: ${String(balance).padStart(3)} | ${(sub ? `${sub.type}/${sub.status}/${sub.currency}` : "no subscription").padEnd(34)} | guardian: ${s.guardian ?? "-"}`
      );
    }
    console.log(`\nGuardians: ${guardianSpecs.map((g) => g.username).join(", ")}`);
    console.log(`Teachers: ${teacherSpecs.map((t) => t.username).join(", ")}`);
    console.log(`Supervisors: ${supervisorSpecs.map((s) => s.username).join(", ")}`);
    console.log(`Sessions seeded: ${sessionSpecs.length} | Applications: ${applications.length} | Invoices: ${standaloneInvoices.length + subSpecs.filter((x) => x.invoice).length}`);
    console.log(`Seed admin id: ${admin.id}`);
    console.log(`Demo login password (ALL users incl. admin): ${DEMO_PASSWORD}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});