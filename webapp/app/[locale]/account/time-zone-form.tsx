"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

/**
 * S-03 / D3: the user picks their own IANA zone (stored as USER, never overwritten by
 * a device — D39). The local time in the picked zone is shown so the choice can be
 * checked at a glance. The zone list and the clock are built after mount only: the
 * server's Intl data and time differ from the browser's (hydration-safe).
 */
type Group = { region: string; zones: string[] };

function groupZones(all: string[]): Group[] {
  const groups = new Map<string, string[]>();
  for (const zone of all) {
    const region = zone.includes("/") ? zone.split("/")[0] : "UTC";
    groups.set(region, [...(groups.get(region) ?? []), zone]);
  }
  return [...groups.entries()].map(([region, zones]) => ({ region, zones }));
}

// A 30-second tick from the browser; the server snapshot (0) means "not mounted yet".
const subscribeTick = (onChange: () => void) => {
  const timer = setInterval(onChange, 30_000);
  return () => clearInterval(timer);
};
const tickSnapshot = () => Math.floor(Date.now() / 30_000);
const serverTick = () => 0;

const cityLabel = (zone: string) => zone.split("/").slice(1).join(" / ").replaceAll("_", " ") || zone;

export default function TimeZoneForm({ current, source }: { current: string; source: string }) {
  const t = useTranslations("account");
  const locale = useLocale();
  const router = useRouter();
  const [zone, setZone] = useState(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const tick = useSyncExternalStore(subscribeTick, tickSnapshot, serverTick);
  const mounted = tick > 0;
  const zones = useMemo(() => {
    if (!mounted) return [current];
    try {
      const all = Intl.supportedValuesOf("timeZone");
      return all.includes(current) ? all : [current, ...all];
    } catch {
      return [current]; // Older browsers: only the stored zone is offered.
    }
  }, [mounted, current]);
  const clock = mounted
    ? new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone: zone, weekday: "long", hour: "numeric", minute: "2-digit" }).format(tick * 30_000)
    : "";

  const groups = useMemo(() => groupZones(zones), [zones]);
  const sourceNote = source === "USER" ? t("sourceUser") : source === "ADMIN" ? t("sourceAdmin") : source === "DEVICE" ? t("sourceDevice") : t("sourceDefault");

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/me/timezone", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone: zone, source: "USER" }) });
      if (!response.ok) {
        setMessage(t("saveFailed"));
        return;
      }
      setMessage(t("saved"));
      router.refresh();
    } catch {
      setMessage(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="grid max-w-md gap-1 text-sm">
        <span className="font-medium text-[var(--navy)]">{t("timeZone")}</span>
        <select value={zone} onChange={(event) => setZone(event.target.value)} className="rounded-lg border border-[var(--line)] bg-surface-container-lowest px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]">
          {groups.length === 1 && groups[0].zones.length === 1 ? (
            <option value={current}>{current.replaceAll("_", " ")}</option>
          ) : (
            groups.map((group) => (
              <optgroup key={group.region} label={group.region}>
                {group.zones.map((name) => <option key={name} value={name}>{cityLabel(name)}</option>)}
              </optgroup>
            ))
          )}
        </select>
      </label>
      <p className="min-h-5 text-sm tabular-nums">{clock ? t("localTime", { time: clock }) : null}</p>
      <p className="max-w-prose text-xs opacity-70">{sourceNote}</p>
      <button type="button" disabled={busy || zone === current} onClick={() => void save()} aria-busy={busy} className="cta-primary rounded-xl px-4 py-2 text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]">
        {t("save")}
      </button>
      {message ? <p role="status" className="text-sm opacity-80">{message}</p> : null}
    </div>
  );
}
