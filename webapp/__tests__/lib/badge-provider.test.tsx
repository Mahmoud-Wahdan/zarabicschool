/**
 * @jest-environment ./__tests__/helpers/jsdom-with-encoding.js
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";

import {
  BADGE_MAX_BACKOFF_MS,
  BADGE_POLL_INTERVAL_MS,
  BADGE_POLL_JITTER,
  BadgeProvider,
  useBadge,
} from "../../app/_components/notifications/badge-provider";

/**
 * A5 (owner decision 2026-10-28): the bell count is fetched ONCE per signed-in user
 * (computed on the server in the root layout, so the first paint needs no request),
 * kept in ONE shared provider that survives navigation, and refreshed only by one
 * slow poll while the tab is visible (plus one refresh when the tab comes back after
 * being hidden longer than the interval). Before: every page remounted the bell, which
 * fetched on mount (2 requests per page in dev StrictMode, 1 in production).
 */
function Count() {
  const { count } = useBadge();
  return <output data-testid="count">{count}</output>;
}

function MarkOne() {
  const { markRead } = useBadge();
  return <button onClick={() => markRead(1)}>read one</button>;
}

let visibility: DocumentVisibilityState = "visible";
const fetchMock = jest.fn();

function answer(count: number) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: { count } }) });
}

function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  // No jitter in tests: Math.random() = 0.5 puts the delay exactly on the interval.
  jest.spyOn(Math, "random").mockReturnValue(0.5);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => answer(7));
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("shared notification badge (A5)", () => {
  it("BP-01: the first paint uses the server count; no request on mount", () => {
    render(<BadgeProvider userId="u1" initialCount={3}><Count /></BadgeProvider>);
    expect(screen.getByTestId("count").textContent).toBe("3");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("BP-02: navigating through 5 pages (new page children each time) makes 0 badge requests", () => {
    const pages = ["/admin", "/admin/sessions", "/admin/enrollments", "/admin/invoices", "/notifications", "/account"];
    const { rerender } = render(<BadgeProvider userId="u1" initialCount={3}><main key={pages[0]}><Count /></main></BadgeProvider>);
    for (const page of pages.slice(1)) {
      rerender(<BadgeProvider userId="u1" initialCount={3}><main key={page}><Count /></main></BadgeProvider>);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("count").textContent).toBe("3");
  });

  it("BP-03: one slow poll per interval while visible (jitter within the named bound)", async () => {
    expect(BADGE_POLL_INTERVAL_MS).toBe(60_000);
    expect(BADGE_POLL_JITTER).toBeGreaterThan(0);
    expect(BADGE_POLL_JITTER).toBeLessThanOrEqual(0.2);
    render(<BadgeProvider userId="u1" initialCount={3}><Count /></BadgeProvider>);
    await advance(BADGE_POLL_INTERVAL_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/notifications/badge");
    await advance(0);
    expect(screen.getByTestId("count").textContent).toBe("7");
    await advance(BADGE_POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("BP-04: no poll while hidden; one refresh on return after a long absence, none after a short one", async () => {
    render(<BadgeProvider userId="u1" initialCount={3}><Count /></BadgeProvider>);
    setVisibility("hidden");
    await advance(BADGE_POLL_INTERVAL_MS * 10);
    expect(fetchMock).not.toHaveBeenCalled();
    setVisibility("visible");
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A short absence: back before the interval -> no extra request, the poll resumes.
    setVisibility("hidden");
    await advance(BADGE_POLL_INTERVAL_MS / 4);
    setVisibility("visible");
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("BP-05: errors back off (doubling, capped), no retry storm", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("network down")));
    render(<BadgeProvider userId="u1" initialCount={3}><Count /></BadgeProvider>);
    await advance(BADGE_POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(BADGE_POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1); // waits 2 x interval after the first failure
    await advance(BADGE_POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(BADGE_MAX_BACKOFF_MS * 3);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2 + 3 + 3);
    expect(screen.getByTestId("count").textContent).toBe("3");
  });

  it("BP-06: a 401 stops the poll (signed out)", async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }));
    render(<BadgeProvider userId="u1" initialCount={3}><Count /></BadgeProvider>);
    await advance(BADGE_POLL_INTERVAL_MS);
    await advance(BADGE_POLL_INTERVAL_MS * 20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("BP-07: unmount aborts the in-flight request and stops the timer", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise(() => undefined);
    });
    const { unmount } = render(<BadgeProvider userId="u1" initialCount={3}><Count /></BadgeProvider>);
    await advance(BADGE_POLL_INTERVAL_MS);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    await advance(BADGE_POLL_INTERVAL_MS * 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("BP-08: marking read updates the shared count locally, never below 0", async () => {
    render(<BadgeProvider userId="u1" initialCount={1}><Count /><MarkOne /></BadgeProvider>);
    act(() => screen.getByText("read one").click());
    expect(screen.getByTestId("count").textContent).toBe("0");
    act(() => screen.getByText("read one").click());
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("BP-10: a streamed server count (a promise) shows when it resolves, with no request", async () => {
    // Real timers: React reveals resolved Suspense content on its own schedule.
    jest.useRealTimers();
    let resolve: (value: number | null) => void = () => undefined;
    const pending = new Promise<number | null>((done) => {
      resolve = done;
    });
    // A component that suspends must be rendered inside an awaited act (React 19).
    await act(async () => {
      render(
        <BadgeProvider userId="u1" initialCount={pending}>
          <Suspense fallback={<output data-testid="count">…</output>}>
            <Count />
          </Suspense>
        </BadgeProvider>,
      );
    });
    expect(screen.getByTestId("count").textContent).toBe("…");
    await act(async () => {
      resolve(4);
      await pending;
    });
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("4"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("BP-11: a streamed count that failed (null) asks the server once", async () => {
    jest.useRealTimers();
    await act(async () => {
      render(
        <BadgeProvider userId="u1" initialCount={Promise.resolve(null)}>
          <Suspense fallback={null}>
            <Count />
          </Suspense>
        </BadgeProvider>,
      );
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("7"));
  });

  it("BP-09 (static): one provider per signed-in session, in the persistent root layout; the shell never fetches", () => {
    const layout = readFileSync(join(process.cwd(), "app/[locale]/layout.tsx"), "utf8");
    expect(layout.match(/<BadgeProvider\b/g)).toHaveLength(1);
    expect(layout).toMatch(/<BadgeProvider[^>]*key=\{/);
    // L1 follow-up: the layout must not wait for the count before streaming (TTFB).
    expect(layout).not.toMatch(/await initialBadgeCount\(/);
    const shell = readFileSync(join(process.cwd(), "app/_components/dashboard-shell.tsx"), "utf8");
    expect(shell).not.toMatch(/\/api\/notifications\/badge/);
    expect(shell).toMatch(/useBadge\(/);
  });
});
