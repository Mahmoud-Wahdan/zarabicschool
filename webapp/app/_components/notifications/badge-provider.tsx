"use client";

import { createContext, use, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Shared notification badge (A5, owner decision 2026-10-28). ONE provider per
 * signed-in user, mounted in the persistent root layout and keyed by the user id, so
 * it survives every client navigation. The first count is computed on the server by
 * that layout and STREAMED as a promise (the layout does not wait for it, so the
 * page's first byte and loading skeleton are not delayed — L1 follow-up); `use()`
 * reads it inside the bell's Suspense boundary, so the first paint needs no request.
 * After that the ONLY refresh is one slow poll while the tab is visible, plus one
 * refresh when the tab comes back after being hidden longer than the interval.
 * Paused while hidden, aborted on unmount, exponential backoff on errors, stopped on
 * 401/403. The bell and the inbox read the same state; marking items read updates
 * it locally.
 *
 * Staleness trade-off: a new item can take up to one interval (+ jitter) to show on
 * the bell of a page that stays open; any full page load shows the server's count.
 */
export const BADGE_URL = "/api/notifications/badge";
export const BADGE_POLL_INTERVAL_MS = 60_000;
/** ± fraction of the interval, so many open tabs do not poll in lock step. */
export const BADGE_POLL_JITTER = 0.1;
export const BADGE_MAX_BACKOFF_MS = 15 * 60_000;

/** The server's first count: a number, a streamed promise, or null (not signed in / failed). */
export type InitialBadgeCount = number | null | Promise<number | null>;

type BadgeContextValue = {
  initial: InitialBadgeCount;
  /** A polled or locally updated value; replaces the server value once set. */
  current: number | null;
  markRead: (n: number) => void;
  markAllRead: () => void;
};

const BadgeContext = createContext<BadgeContextValue>({ initial: 0, current: null, markRead: () => undefined, markAllRead: () => undefined });

const isPromise = (value: InitialBadgeCount): value is Promise<number | null> => typeof (value as Promise<unknown> | null)?.then === "function";

/** Suspends (inside the caller's Suspense boundary) until a streamed server count arrives. */
export function useBadge(): { count: number; markRead: (n: number) => void; markAllRead: () => void } {
  const context = useContext(BadgeContext);
  const server = isPromise(context.initial) ? use(context.initial) : context.initial;
  return { count: context.current ?? server ?? 0, markRead: context.markRead, markAllRead: context.markAllRead };
}

/** The mark-read actions only: never suspends (the inbox list does not show the count). */
export function useBadgeActions(): { markRead: (n: number) => void; markAllRead: () => void } {
  const { markRead, markAllRead } = useContext(BadgeContext);
  return { markRead, markAllRead };
}

function nextDelay(failures: number): number {
  const base = Math.min(BADGE_MAX_BACKOFF_MS, BADGE_POLL_INTERVAL_MS * 2 ** failures);
  return Math.round(base * (1 + (Math.random() * 2 - 1) * BADGE_POLL_JITTER));
}

export function BadgeProvider({ userId, initialCount, children }: { userId: string | null; initialCount: InitialBadgeCount; children: ReactNode }) {
  const [current, setCurrent] = useState<number | null>(null);
  // A server re-render (router.refresh) brings a fresh count: it wins again.
  const [source, setSource] = useState(initialCount);
  if (source !== initialCount) {
    setSource(initialCount);
    setCurrent(null);
  }
  // The last server value, for local "mark read" updates before any poll.
  const serverValue = useRef(typeof initialCount === "number" ? initialCount : 0);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;
    let hiddenAt: number | null = null;

    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(() => void refresh(), nextDelay(failures));
    };

    const refresh = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const response = await fetch(BADGE_URL, { signal: controller.signal, cache: "no-store" });
        if (response.status === 401 || response.status === 403) {
          stopped = true;
          return;
        }
        if (!response.ok) throw new Error(`badge ${response.status}`);
        const payload = (await response.json()) as { data?: { count?: unknown } };
        if (typeof payload.data?.count === "number") setCurrent(payload.data.count);
        failures = 0;
      } catch {
        if (controller.signal.aborted) return;
        failures += 1;
      }
      schedule();
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        clearTimeout(timer);
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away > BADGE_POLL_INTERVAL_MS) void refresh();
      else schedule();
    };

    // No server count (it failed): one request now; otherwise wait a full interval.
    const start = (value: number | null) => {
      if (stopped) return;
      if (value === null) void refresh();
      else {
        serverValue.current = value;
        schedule();
      }
    };
    if (isPromise(initialCount)) initialCount.then(start, () => start(null));
    else start(initialCount);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // initialCount is read once at mount; a later server count arrives through `source`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const markRead = useCallback((n: number) => setCurrent((value) => Math.max(0, (value ?? serverValue.current) - Math.max(0, n))), []);
  const markAllRead = useCallback(() => setCurrent(0), []);
  const value = useMemo(() => ({ initial: initialCount, current, markRead, markAllRead }), [initialCount, current, markRead, markAllRead]);
  return <BadgeContext.Provider value={value}>{children}</BadgeContext.Provider>;
}
