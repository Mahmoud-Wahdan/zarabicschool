"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const REFRESH_EVERY_MS = 3000;
const MAX_REFRESHES = 20; // ~60 s, then the page shows the "still processing" note.

/**
 * Re-renders the (server) return page while the payment is still PROCESSING, so the
 * status the signed webhook writes appears without a manual reload. It only asks the
 * server again — it never decides anything itself.
 */
export default function PaymentReturnRefresher({ stillProcessingText }: { stillProcessingText: string }) {
  const router = useRouter();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (count >= MAX_REFRESHES) return;
    const timer = setTimeout(() => {
      router.refresh();
      setCount((value) => value + 1);
    }, REFRESH_EVERY_MS);
    return () => clearTimeout(timer);
  }, [count, router]);

  if (count < MAX_REFRESHES) {
    return <span className="material-symbols-outlined animate-spin text-xl text-primary" aria-hidden="true">progress_activity</span>;
  }
  return <p className="text-body-sm text-on-surface-variant">{stillProcessingText}</p>;
}
