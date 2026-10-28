"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * S-03 / D3: reports the device time zone (browser Intl) once per browser session.
 * The server stores it only while the user's zone came from the default or a device
 * (D39); a user's or Admin's choice is kept. Refreshes the page when the zone changed
 * so times re-render in the new zone. Renders nothing.
 */
const KEY = "zarabic:tz-sync";

export default function DeviceTimeZoneSync() {
  const router = useRouter();
  useEffect(() => {
    let timezone: string;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!timezone || sessionStorage.getItem(KEY) === timezone) return;
      sessionStorage.setItem(KEY, timezone);
    } catch {
      return;
    }
    void fetch("/api/me/timezone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone, source: "DEVICE" }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.data?.changed) router.refresh();
      })
      .catch(() => undefined);
  }, [router]);
  return null;
}
