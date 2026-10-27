import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { formatDateTime } from "../../lib/schedules/display";
import { rangeFromInputs, rangeToInputs } from "../../lib/schedules/form-times";
import { sessionCreateSchema } from "../../lib/validation/management";

/**
 * Time-zone audit (owner screenshot, 2026-10-27): the Admin reschedule form showed
 * "New start (UTC)", parsed the typed time as UTC and opened empty, while the list
 * showed the same session in Cairo. Rule: every datetime input pre-fills the stored
 * instant in the VIEWER's zone, parses back in that zone and names that zone on its
 * label; every date/time render passes an explicit zone (never the host's/browser's).
 */
const CAIRO = "Africa/Cairo";
const ROOT = process.cwd();

function read(file: string) {
  return readFileSync(join(ROOT, file), "utf8");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("viewer-zone date/time forms and renders", () => {
  it("ZF-01: round trip — open the reschedule form, change nothing, save: the stored instants do not move (27 and 30 Oct)", () => {
    for (const [start, end] of [
      ["2026-10-27T19:00:00.000Z", "2026-10-27T20:00:00.000Z"],
      ["2026-10-30T16:00:00.000Z", "2026-10-30T17:00:00.000Z"],
      ["2026-10-29T20:30:00.000Z", "2026-10-29T21:30:00.000Z"],
    ]) {
      const inputs = rangeToInputs(start, end, CAIRO);
      expect(rangeFromInputs(inputs.start, inputs.end, CAIRO, { start, end })).toEqual({ start, end });
    }
  });

  it("ZF-02: the form shows the Cairo wall clock the list shows (22:00 on 27 Oct, not 19:00 UTC)", () => {
    expect(rangeToInputs("2026-10-27T19:00:00.000Z", "2026-10-27T20:00:00.000Z", CAIRO)).toEqual({
      start: "2026-10-27T22:00",
      end: "2026-10-27T23:00",
    });
    // Typing 17:00 stores 14:00Z on 27 Oct (UTC+3) and 15:00Z on 30 Oct (UTC+2) — it displays 17:00 again.
    expect(rangeFromInputs("2026-10-27T17:00", "2026-10-27T18:00", CAIRO).start).toBe("2026-10-27T14:00:00.000Z");
    expect(rangeFromInputs("2026-10-30T17:00", "2026-10-30T18:00", CAIRO).start).toBe("2026-10-30T15:00:00.000Z");
    expect(formatDateTime("2026-10-30T15:00:00.000Z", CAIRO, "en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).toBe("17:00");
  });

  it("ZF-03 (static): every Intl.DateTimeFormat in app/ and lib/ passes an explicit timeZone", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib"))]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/new Intl\.DateTimeFormat\(/g)) {
        const args = source.slice(match.index, match.index + 400);
        const close = args.indexOf("})");
        if (!/timeZone/.test(close === -1 ? args : args.slice(0, close))) {
          offenders.push(`${relative(ROOT, file)}:${source.slice(0, match.index).split("\n").length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ZF-04 (static): reschedule and session-request forms use the viewer zone; no UTC label, option or default", () => {
    const panel = read("app/[locale]/admin/sessions/session-management-panel.tsx");
    expect(panel).not.toMatch(/\(\{session\.timezone\}\)|target\.timezone/);
    expect(panel).toMatch(/rangeToInputs\(session\.scheduledStart, session\.scheduledEnd, viewerTimezone\)/);
    expect(panel).not.toMatch(/"UTC"/);
    const requests = read("app/_components/session-requests/session-requests-panel.tsx");
    expect(requests).not.toMatch(/selected\.timezone\)|request\.timezone\)/);
    expect(requests).toMatch(/viewerTimezone/);
    const detail = read("app/[locale]/admin/sessions/[id]/page.tsx");
    expect(detail).not.toMatch(/\(\{session\.timezone\}\)/);
  });

  it("ZF-05: a session created without a zone is no longer stored as UTC (the route uses the creator's zone)", () => {
    const parsed = sessionCreateSchema.safeParse({
      teacherId: "00000000-0000-4000-8000-000000000001",
      subjectId: "00000000-0000-4000-8000-000000000002",
      sessionType: "PRIVATE",
      scheduledStart: "2026-10-30T15:00:00.000Z",
      scheduledEnd: "2026-10-30T16:00:00.000Z",
      zoomJoinUrl: "https://zoom.us/j/123456789012",
      studentIds: ["00000000-0000-4000-8000-000000000003"],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.timezone).toBeUndefined();
    expect(read("app/api/sessions/route.ts")).toMatch(/timezone: data\.timezone \?\? user\.timezone/);
  });
});
