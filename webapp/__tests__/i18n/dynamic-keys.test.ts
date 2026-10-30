import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * Dynamic message keys (A2, owner 2026-10-28). `message-keys.test.ts` checks literal
 * keys only; a template key such as t(`events.${row.eventType}`) failed at runtime
 * with MISSING_MESSAGE (paymentAudit.events.PROVIDER_REFUND_SEEN, locale ar) because
 * the event union grew and nobody added the text.
 *
 * Every template-literal translator call in app/ and lib/ must be registered below
 * with the ONE source its values come from (a Prisma enum, a TypeScript union or a
 * const list in the code). For each value, `namespace.prefix<value>suffix` must be a
 * STRING message in both en and ar. A new dynamic call without an entry fails, so the
 * registry cannot silently fall behind the code.
 */
type Catalog = Record<string, unknown>;
const ROOT = process.cwd();
const catalogs = {
  en: JSON.parse(readFileSync(join(ROOT, "messages/en.json"), "utf8")) as Catalog,
  ar: JSON.parse(readFileSync(join(ROOT, "messages/ar.json"), "utf8")) as Catalog,
};

function leaf(catalog: Catalog, key: string): unknown {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Catalog)[part];
  }
  return node;
}

// ---- value sources -------------------------------------------------------------
const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
function prismaEnum(name: string): string[] {
  const block = schema.match(new RegExp(String.raw`^enum ${name} \{([\s\S]*?)^\}`, "m"));
  if (!block) throw new Error(`enum ${name} not found`);
  return block[1].split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("//")).map((line) => line.split(/\s+/)[0]);
}

/** String literals of `type <name> = "A" | "B"` or `const <name> = [..]` / `new Set([..])` in a file. */
function literals(file: string, name: string): string[] {
  const path = join(ROOT, file);
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if ((ts.isTypeAliasDeclaration(node) || ts.isVariableDeclaration(node)) && node.name.getText(source) === name) found = ts.isTypeAliasDeclaration(node) ? node.type : node.initializer;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) throw new Error(`${name} not found in ${file}`);
  const values: string[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isStringLiteral(node)) values.push(node.text);
    ts.forEachChild(node, collect);
  };
  collect(found);
  if (values.length === 0) throw new Error(`${name} in ${file} has no string literals`);
  return values;
}

/** Arguments of every `fn("literal")` call in a file (label helpers). */
function callArgs(file: string, fn: string): string[] {
  const text = readFileSync(join(ROOT, file), "utf8");
  return [...text.matchAll(new RegExp(String.raw`(?<![\w.])${fn}\("([^"]+)"\)`, "g"))].map((match) => match[1]);
}

/** `key: "x"` properties in a file (navigation items). */
function navKeys(file: string): string[] {
  const text = readFileSync(join(ROOT, file), "utf8");
  return [...text.matchAll(/\{\s*key:\s*"([^"]+)"/g)].map((match) => match[1]);
}

const USER_ROLES = () => prismaEnum("UserRole");
const SESSION_STATUS = () => prismaEnum("SessionStatus");

/**
 * Registry: `namespace.template` with every `${...}` written as `*` → its values.
 * Extra values (a fallback such as "NONE" or "MISSING") are listed with the source
 * they extend; a call that restricts the value on the same line lists those values.
 */
const REGISTRY: Record<string, () => string[]> = {
  "adminApplications.detail.*": () => callArgs("app/[locale]/admin/applications/[id]/page.tsx", "label"),
  "adminApplications.status.*": () => prismaEnum("ApplicationStatus"),
  "adminApplications.type.*": () => prismaEnum("ApplicationType"),
  "adminDash.status.*": SESSION_STATUS,
  "management.enrollments.errors.*": () => literals("app/[locale]/admin/enrollments/enrollments-panel.tsx", "KNOWN_ERRORS"),
  "assignmentsAdmin.errors.*": () => literals("app/[locale]/admin/assignments/student-assignments-panel.tsx", "KNOWN_ERRORS"),
  "supervisorDash.status.*": SESSION_STATUS,
  "sessions.statuses.*": SESSION_STATUS,
  "sessionsAdmin.statuses.*": SESSION_STATUS,
  "sessions.types.*": () => prismaEnum("SessionType"),
  "sessionsAdmin.series.statuses.*": () => prismaEnum("RecurrenceSeriesStatus"),
  "sessionsAdmin.zoom.reasons.*": () => literals("lib/validation/zoom-url.ts", "ZoomUrlInvalidReason"),
  "adminSessionDetail.attendance.*": () => prismaEnum("AttendanceStatus"),
  "adminSessionDetail.payrollType.*": () => prismaEnum("PayrollLedgerEntryType"),
  "adminSessionDetail.deductionType.*": () => prismaEnum("SubscriptionLedgerEntryType"),
  "applyForm.*Title": () => literals("app/[locale]/apply/apply-form.tsx", "RoleType"),
  "applyForm.*Subtitle": () => literals("app/[locale]/apply/apply-form.tsx", "RoleType"),
  "landing.roleCards.*.badge": () => literals("app/_components/landing/apply-role-cards.tsx", "RoleKey"),
  "landing.roleCards.*.cta": () => literals("app/_components/landing/apply-role-cards.tsx", "RoleKey"),
  "landing.roleCards.*.description": () => literals("app/_components/landing/apply-role-cards.tsx", "RoleKey"),
  "landing.roleCards.*.points": () => literals("app/_components/landing/apply-role-cards.tsx", "RoleKey"),
  "landing.roleCards.*.foot": () => literals("app/_components/landing/apply-role-cards.tsx", "RoleKey"),
  "landing.roleCards.*.subtitle": () => literals("app/_components/landing/apply-role-cards.tsx", "RoleKey"),
  "landing.roleCards.*.title": () => literals("app/_components/landing/apply-role-cards.tsx", "RoleKey"),
  "appShell.nav.*": () => navKeys("app/_components/dashboard-shell.tsx"),
  "dashboard.roles.*": USER_ROLES,
  "attendance.sessionStatuses.*": SESSION_STATUS,
  "attendance.attendanceStatuses.*": () => prismaEnum("AttendanceStatus"),
  "attendance.reportStatuses.*": () => [...prismaEnum("ReportStatus"), "MISSING"],
  "attendanceResolution.blocked.*": () => [], // guarded by t.has() with a server-message fallback
  "attendanceResolution.outcome.*": () => prismaEnum("AttendanceOutcome"),
  "attendanceResolution.effect.attendance.*": () => literals("lib/attendance/resolution.ts", "ResolutionOutcome"),
  "attendanceResolution.state.*": () => ["ENDED_REPORT_PENDING", "RESOLVED_REPORT_PENDING"], // restricted on the same line
  "clickTimeline.roles.*": USER_ROLES,
  "complaintForm.category.*": () => prismaEnum("ComplaintCategory"),
  "complaintForm.role.*": () => prismaEnum("ComplaintPartyRole"),
  "complaintsAdmin.category.*": () => prismaEnum("ComplaintCategory"),
  "complaintsAdmin.role.*": () => prismaEnum("ComplaintPartyRole"),
  "complaintsAdmin.status.*": () => prismaEnum("ComplaintStatus"),
  "evaluation.errors.*": () => literals("app/_components/evaluations/evaluation-card.tsx", "EVALUATION_ERROR_CODES"),
  "evaluationSummaries.author.*": () => prismaEnum("EvaluationAuthorType"),
  "financialsAdmin.status.*": () => prismaEnum("InvoiceStatus"),
  "financialsAdmin.subscriptionStatus.*": () => prismaEnum("SubscriptionStatus"),
  "invoices.status.*": () => prismaEnum("InvoiceStatus"),
  "inbox.kind.*": () => [], // guarded by t.has() with kind.OTHER; INB-03 covers every composed kind
  "joinStatus.reason.*": () => [...literals("app/[locale]/join-status/page.tsx", "KNOWN_REASONS"), "UNKNOWN"],
  "management.form.paymentStatus.*": () => [...prismaEnum("InvoiceStatus"), "NONE"],
  "paymentAudit.events.*": () => literals("lib/payments/audit-events.ts", "PAYMENT_AUDIT_EVENT_TYPES"),
  "paymentReturn.state.*": () => literals("lib/payments/return-status.ts", "PaymentReturnState"),
  "payroll.category.*": () => literals("lib/payroll/adjustments.ts", "AdjustmentCategory"),
  "payroll.entryType.*": () => prismaEnum("PayrollLedgerEntryType"),
  "renewal.status.*": () => prismaEnum("BillingSubscriptionStatus"),
  "revenueChart.period.*": () => literals("lib/finance/revenue.ts", "RevenuePeriod"),
  "sessionRequests.roles.*": USER_ROLES,
  "sessionRequests.statuses.*": () => prismaEnum("SessionRequestStatus"),
  "teacherReport.errors.*": () => literals("app/[locale]/teacher/sessions/[id]/report/report-form.tsx", "KNOWN_ERROR_CODES"),
  "teacherReport.errors.fields.*": () => literals("app/[locale]/teacher/sessions/[id]/report/report-form.tsx", "FIELD_ERROR_KEYS"),
};

/** Templates read with t.raw() whose message is a list of strings. */
const RAW_LISTS = new Set(["landing.roleCards.*.points"]);

// ---- the scan ------------------------------------------------------------------
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const TRANSLATOR = /(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)"|\{[^}]*namespace:\s*"([^"]*)"[^}]*\})?\s*\)/;
function translators(source: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const match of source.matchAll(new RegExp(String.raw`const\s+(\w+)\s*=\s*(?:await\s+)?` + TRANSLATOR.source, "g"))) vars.set(match[1], match[2] ?? match[3] ?? "");
  for (const match of source.matchAll(/const\s*\[([^\]]+)\]\s*=\s*await\s+Promise\.all\(\[([\s\S]*?)\]\)/g)) {
    const names = match[1].split(",").map((name) => name.trim());
    const calls = match[2].split(/,(?![^(]*\))/).map((part) => part.match(TRANSLATOR));
    names.forEach((name, index) => {
      const call = calls[index];
      if (name && call) vars.set(name, call[1] ?? call[2] ?? "");
    });
  }
  return vars;
}

/** Every dynamic call as `namespace.template` (with `*`) → the files using it. */
function dynamicCalls(): Map<string, string[]> {
  const calls = new Map<string, string[]>();
  for (const file of [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib"))]) {
    const source = readFileSync(file, "utf8");
    for (const [name, namespace] of translators(source)) {
      for (const match of source.matchAll(new RegExp(String.raw`(?<![\w.])${name}(?:\.rich|\.markup|\.raw|\.has)?\(\s*\`([^\`]*)\``, "g"))) {
        const template = match[1].replace(/\$\{[^}]*\}/g, "*");
        const key = namespace ? `${namespace}.${template}` : template;
        calls.set(key, [...(calls.get(key) ?? []), relative(ROOT, file)]);
      }
    }
  }
  return calls;
}

describe("i18n dynamic message keys (A2)", () => {
  const calls = dynamicCalls();

  it("DYN-01: every template-literal t() call is registered with its value source", () => {
    const unregistered = [...calls.entries()].filter(([key]) => !(key in REGISTRY)).map(([key, files]) => `${key}  (${[...new Set(files)].join(", ")})`);
    expect(unregistered).toEqual([]);
  });

  it("DYN-02: no stale registry entry (each one is still used)", () => {
    expect(Object.keys(REGISTRY).filter((key) => !calls.has(key))).toEqual([]);
  });

  it("DYN-03: every value of every dynamic key is a string message in en and ar", () => {
    const missing: string[] = [];
    for (const [template, values] of Object.entries(REGISTRY)) {
      for (const value of values()) {
        const key = template.replace("*", value);
        for (const [locale, catalog] of Object.entries(catalogs)) {
          const value = leaf(catalog, key);
          // A t.raw() list (landing role points) is an array of strings; everything else is one string.
          const ok = RAW_LISTS.has(template) ? Array.isArray(value) && value.every((item) => typeof item === "string") : typeof value === "string";
          if (!ok) missing.push(`${locale}:${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("DYN-04: the payment audit event list matches the database CHECK of the latest migration", () => {
    const dir = join(ROOT, "prisma/migrations");
    const latest = readdirSync(dir).filter((name) => {
      try {
        return /payment_audit_event_type_check/.test(readFileSync(join(dir, name, "migration.sql"), "utf8"));
      } catch {
        return false;
      }
    }).sort().pop()!;
    const sql = readFileSync(join(dir, latest, "migration.sql"), "utf8");
    const check = sql.slice(sql.lastIndexOf("payment_audit_event_type_check")).match(/IN\s*\(([^)]*)\)/)![1];
    const inDb = [...check.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort();
    expect(literals("lib/payments/audit-events.ts", "PAYMENT_AUDIT_EVENT_TYPES").sort()).toEqual(inDb);
  });
});
