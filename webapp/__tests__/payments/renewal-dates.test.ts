import {
  anchorDayOf,
  firstPeriod,
  nextPeriodAfter,
} from "../../lib/billing/renewal-dates";

/**
 * D56 (owner, 2026-10-27): renewals fall on the same day of the month as the first
 * payment; a day that does not exist moves to the month's last day. Periods run from
 * local midnight on the anchor date to local midnight on the next one (Africa/Cairo
 * by default), and `nextBilling` is the Paymob `next_billing` date.
 */
const CAIRO = "Africa/Cairo";

describe("D56 renewal dates", () => {
  it("RD-01: the anchor day is the local day of the first payment (23:30 UTC on the 9th is the 10th in Cairo)", () => {
    expect(anchorDayOf(new Date("2026-10-09T23:30:00Z"), CAIRO)).toBe(10);
    expect(anchorDayOf(new Date("2026-10-10T12:00:00Z"), CAIRO)).toBe(10);
  });

  it("RD-02: the first period starts at the payment and ends at local midnight on the next month's anchor date", () => {
    const period = firstPeriod(new Date("2026-10-10T12:00:00Z"), CAIRO);
    expect(period.anchorDay).toBe(10);
    expect(period.start.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    // 10 Nov 00:00 Cairo (EET, UTC+2 after the DST end on 29 Oct).
    expect(period.end.toISOString()).toBe("2026-11-09T22:00:00.000Z");
    expect(period.nextBilling).toBe("2026-11-10");
    expect(period.startDate).toBe("2026-10-10");
  });

  it("RD-03: the 31st moves to the month's last day, then back to the 31st when it exists", () => {
    const jan = firstPeriod(new Date("2027-01-31T10:00:00Z"), CAIRO);
    expect(jan.nextBilling).toBe("2027-02-28");
    const feb = nextPeriodAfter(jan.end, 31, CAIRO);
    expect(feb.startDate).toBe("2027-02-28");
    expect(feb.nextBilling).toBe("2027-03-31");
    const apr = nextPeriodAfter(nextPeriodAfter(feb.end, 31, CAIRO).end, 31, CAIRO);
    expect(apr.startDate).toBe("2027-04-30");
    expect(apr.nextBilling).toBe("2027-05-31");
  });

  it("RD-04: a leap year keeps the 29th of February for anchor 29, 30 and 31", () => {
    for (const anchor of [29, 30, 31]) {
      const jan = nextPeriodAfter(new Date("2028-01-15T00:00:00Z"), anchor, CAIRO);
      expect(jan.nextBilling).toBe("2028-02-29");
    }
  });

  it("RD-05: the next period starts exactly where the previous one ended (no gap, no overlap)", () => {
    const first = firstPeriod(new Date("2026-10-10T12:00:00Z"), CAIRO);
    const second = nextPeriodAfter(first.end, first.anchorDay, CAIRO);
    expect(second.start.getTime()).toBe(first.end.getTime());
    expect(second.startDate).toBe("2026-11-10");
    expect(second.nextBilling).toBe("2026-12-10");
    expect(second.end.toISOString()).toBe("2026-12-09T22:00:00.000Z");
  });

  it("RD-06: December rolls into January of the next year", () => {
    const dec = nextPeriodAfter(new Date("2026-12-09T22:00:00Z"), 10, CAIRO);
    expect(dec.nextBilling).toBe("2027-01-10");
  });

  it("RD-07: an invalid anchor day is refused", () => {
    expect(() => nextPeriodAfter(new Date(), 0, CAIRO)).toThrow();
    expect(() => nextPeriodAfter(new Date(), 32, CAIRO)).toThrow();
  });
});
