import { findLinkOverlaps, type LinkOverlapInput } from "../../lib/scheduling/link-overlap";

const LINK_A = "https://zoom.us/j/1111111111";
const LINK_B = "https://zoom.us/j/2222222222";

function session(overrides: Partial<LinkOverlapInput> & { id: string }): LinkOverlapInput {
  return {
    zoomJoinUrl: LINK_A,
    scheduledStart: "2026-10-20T10:00:00.000Z",
    scheduledEnd: "2026-10-20T11:00:00.000Z",
    status: "SCHEDULED",
    ...overrides,
  };
}

describe("findLinkOverlaps", () => {
  it("flags two scheduled sessions that share a join link and overlap in time", () => {
    const warning = findLinkOverlaps([
      session({ id: "a", scheduledStart: "2026-10-20T10:00:00.000Z", scheduledEnd: "2026-10-20T11:00:00.000Z" }),
      session({ id: "b", scheduledStart: "2026-10-20T10:30:00.000Z", scheduledEnd: "2026-10-20T11:30:00.000Z" }),
    ]);
    expect(warning).toEqual({ code: "ZOOM_LINK_OVERLAP", sessionIds: ["a", "b"] });
  });

  it("ignores the same link when the ranges do not overlap (touching ends are not an overlap)", () => {
    const warning = findLinkOverlaps([
      session({ id: "a", scheduledEnd: "2026-10-20T11:00:00.000Z" }),
      session({ id: "b", scheduledStart: "2026-10-20T11:00:00.000Z", scheduledEnd: "2026-10-20T12:00:00.000Z" }),
    ]);
    expect(warning).toBeNull();
  });

  it("ignores overlapping sessions that use different join links", () => {
    const warning = findLinkOverlaps([
      session({ id: "a" }),
      session({ id: "b", zoomJoinUrl: LINK_B, scheduledStart: "2026-10-20T10:30:00.000Z" }),
    ]);
    expect(warning).toBeNull();
  });

  it("ignores cancelled sessions sharing the link", () => {
    const warning = findLinkOverlaps([
      session({ id: "a" }),
      session({ id: "b", status: "CANCELLED", scheduledStart: "2026-10-20T10:30:00.000Z" }),
    ]);
    expect(warning).toBeNull();
  });

  it("groups every session involved in a same-link overlap and ignores non-involved ones", () => {
    const warning = findLinkOverlaps([
      session({ id: "a", scheduledStart: "2026-10-20T08:00:00.000Z", scheduledEnd: "2026-10-20T09:00:00.000Z" }),
      session({ id: "b", scheduledStart: "2026-10-20T08:30:00.000Z", scheduledEnd: "2026-10-20T09:30:00.000Z" }),
      session({ id: "d", scheduledStart: "2026-10-20T10:00:00.000Z", scheduledEnd: "2026-10-20T11:00:00.000Z" }),
      session({ id: "c", zoomJoinUrl: LINK_B, scheduledStart: "2026-10-20T08:00:00.000Z", scheduledEnd: "2026-10-20T09:00:00.000Z" }),
    ]);
    expect(warning).toEqual({ code: "ZOOM_LINK_OVERLAP", sessionIds: ["a", "b"] });
  });

  it("accepts Date objects and ISO strings interchangeably", () => {
    const warning = findLinkOverlaps([
      session({ id: "a", scheduledStart: new Date("2026-10-20T10:00:00.000Z"), scheduledEnd: new Date("2026-10-20T11:00:00.000Z") }),
      session({ id: "b", scheduledStart: "2026-10-20T10:15:00.000Z", scheduledEnd: "2026-10-20T10:45:00.000Z" }),
    ]);
    expect(warning?.sessionIds).toContain("a");
    expect(warning?.sessionIds).toContain("b");
  });

  it("returns null for an empty list", () => {
    expect(findLinkOverlaps([])).toBeNull();
  });
});
