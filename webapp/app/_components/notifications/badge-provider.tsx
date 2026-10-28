"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Shared notification badge (A5, owner decision 2026-10-28). ONE provider per
 * signed-in user, mounted in the persistent root layout and keyed by the user id, so
 * it survives every client navigation. The first count is computed on the server in
 * that layout (no request for the first paint); after that the ONLY refresh is one
 * slow poll while the tab is visible, plus one refresh when the tab comes back after
 * being hidden longer than the interval. Paused while hidden, aborted on unmount,
 * exponential backoff on errors, stopped on 401/403. The bell and the inbox read the
 * same state; marking items read updates it locally.
 *
 * Staleness trade-off: a new item can take up to one interval (+ jitter) to show on
 * the bell of a page that stays open; any full page load shows the server's count.
 */
export const BADGE_URL = "/api/notifications/badge";
export const BADGE_POLL_INTERVAL_MS = 60_000;
/** ± fraction of the interval, so many open tabs do not poll in lock step. */
export const BADGE_POLL_JITTER = 0.1;
export const BADGE_MAX_BACKOFF_MS = 15 * 60_000;

type BadgeState = {
  count: number;
  /** Local update after the viewer marked `n` items read. */
  markRead: (n: number) => void;
  /** Local update after the viewer marked everything read. */
  markAllRead: () => void;
};

const BadgeContext = createContext<BadgeState>({ count: 0, markRead: () => undefined, markAllRead: () => undefined });

export function useBadge(): BadgeState {
  return useContext(BadgeContext);
}

function nextDelay(failures: number): number {
  const base = Math.min(BADGE_MAX_BACKOFF_MS, BADGE_POLL_INTERVAL_MS * 2 ** failures);
  return Math.round(base * (1 + (Math.random() * 2 - 1) * BADGE_POLL_JITTER));
}

export function BadgeProvider({ userId, initialCount, children }: { userId: string | null; initialCount: number | null; children: ReactNode }) {
  const [count, setCount] = useState(initialCount ?? 0);
  // A server re-render (router.refresh) brings a fresh count: adopt it.
  const [serverCount, setServerCount] = useState(initialCount);
  if (initialCount !== serverCount) {
    setServerCount(initialCount);
    if (initialCount !== null) setCount(initialCount);
  }

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
        if (typeof payload.data?.count === "number") setCount(payload.data.count);
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
    if (initialCount === null) void refresh();
    else schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // initialCount is read once at mount; later server counts arrive through state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const markRead = useCallback((n: number) => setCount((current) => Math.max(0, current - Math.max(0, n))), []);
  const markAllRead = useCallback(() => setCount(0), []);
  const value = useMemo(() => ({ count, markRead, markAllRead }), [count, markRead, markAllRead]);
  return <BadgeContext.Provider value={value}>{children}</BadgeContext.Provider>;
}
