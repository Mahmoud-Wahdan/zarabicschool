import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  utcToWallClockInput,
  wallClockInputToUtc,
  zonedDayRangeUtc,
  zonedYmd,
} from "../../lib/schedules/recurrence";

/**
 * Africa/Cairo time-input bug (owner, 2026-10-27). Cairo is UTC+3 until the night of
 * Thursday 2026-10-29 (24:00 → 23:00), then UTC+2. A typed time or a "today" window
 * must be read in the session's / viewer's zone, never in the zone of the machine
 * that runs the code (the owner's PC is in Cairo, a production host is UTC, a staff
 * browser may be elsewhere).
 */
const CAIRO = "Africa/Cairo";

describe("Africa/Cairo time input across the 2026-10-29 DST change", () => {
  it("TZ-01: a typed 18:00 is 15:00Z on 2026-10-27 (UTC+3) and 16:00Z on 2026-10-30 (UTC+2)", () => {
    expect(wallClockInputToUtc("2026-10-27T18:00", CAIRO).toISOString()).toBe("2026-10-27T15:00:00.000Z");
    expect(wallClockInputToUtc("2026-10-30T18:00", CAIRO).toISOString()).toBe("2026-10-30T16:00:00.000Z");
  });

  it("TZ-02: a stored instant pre-fills the input with the Cairo wall clock on both dates", () => {
    expect(utcToWallClockInput(new Date("2026-10-27T15:00:00Z"), CAIRO)).toBe("2026-10-27T18:00");
    expect(utcToWallClockInput(new Date("2026-10-30T16:00:00Z"), CAIRO)).toBe("2026-10-30T18:00");
    for (const value of ["2026-10-27T18:00", "2026-10-30T18:00", "2026-10-27T00:30", "2026-10-30T23:45"]) {
      expect(utcToWallClockInput(wallClockInputToUtc(value, CAIRO), CAIRO)).toBe(value);
    }
  });

  it("TZ-03: a Cairo calendar day maps to its own UTC range (24 h, and 25 h on 2026-10-29)", () => {
    expect(zonedDayRangeUtc("2026-10-27", CAIRO)).toEqual({
      start: new Date("2026-10-26T21:00:00Z"),
      end: new Date("2026-10-27T21:00:00Z"),
    });
    expect(zonedDayRangeUtc("2026-10-30", CAIRO)).toEqual({
      start: new Date("2026-10-29T22:00:00Z"),
      end: new Date("2026-10-30T22:00:00Z"),
    });
    const changeDay = zonedDayRangeUtc("2026-10-29", CAIRO);
    expect(changeDay.end.getTime() - changeDay.start.getTime()).toBe(25 * 3600 * 1000);
  });

  it("TZ-04: 'today' is the Cairo calendar day, not the host's", () => {
    expect(zonedYmd(new Date("2026-10-27T21:30:00Z"), CAIRO)).toBe("2026-10-28");
    expect(zonedYmd(new Date("2026-10-29T21:30:00Z"), CAIRO)).toBe("2026-10-29");
    expect(zonedYmd(new Date("2026-10-29T22:30:00Z"), CAIRO)).toBe("2026-10-30");
  });

  it("TZ-05 (static): no caller reads a typed time or 'today' in the host or browser zone", () => {
    const files = [
      "app/[locale]/admin/page.tsx",
      "app/[locale]/supervisor/page.tsx",
      "app/_components/reports-queue/reports-queue-page.tsx",
      "app/_components/session-requests/session-requests-panel.tsx",
      "app/_components/payroll/admin-payroll-panel.tsx",
      "app/_components/announcements/announcement-composer.tsx",
    ];
    for (const file of files) {
      const code = readFileSync(join(process.cwd(), file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect({ file, hostDay: /\.setHours\(0/.test(code) }).toEqual({ file, hostDay: false });
      expect({ file, naiveParse: /new Date\(`\$\{[^}]+\}T/.test(code) }).toEqual({ file, naiveParse: false });
      expect({ file, inputParse: /new Date\((startInput|rate\.effectiveFrom)\)/.test(code) }).toEqual({ file, inputParse: false });
      expect({ file, browserGetters: /\.getHours\(\)/.test(code) }).toEqual({ file, browserGetters: false });
    }
  });
});
