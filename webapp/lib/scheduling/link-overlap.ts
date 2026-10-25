export type LinkOverlapInput = {
  id: string;
  zoomJoinUrl: string;
  scheduledStart: Date | string;
  scheduledEnd: Date | string;
  status: string;
};

export type LinkOverlapWarning = {
  code: "ZOOM_LINK_OVERLAP";
  sessionIds: string[];
};

function overlaps(a: LinkOverlapInput, b: LinkOverlapInput): boolean {
  const aStart = new Date(a.scheduledStart).getTime();
  const aEnd = new Date(a.scheduledEnd).getTime();
  const bStart = new Date(b.scheduledStart).getTime();
  const bEnd = new Date(b.scheduledEnd).getTime();
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Pure helper for the CONFIRMED same-link overlap warning (CONTEXT §17: the free Zoom
 * account can run one meeting at a time, so two SCHEDULED sessions sharing a join link
 * with overlapping time ranges produce a WARNING — never a block). Reports every session
 * involved in any same-link overlap pair.
 */
export function findLinkOverlaps(sessions: LinkOverlapInput[]): LinkOverlapWarning | null {
  const active = sessions.filter((session) => session.status === "SCHEDULED");
  const byLink = new Map<string, LinkOverlapInput[]>();
  for (const session of active) {
    const key = session.zoomJoinUrl.trim();
    const group = byLink.get(key);
    if (group) group.push(session);
    else byLink.set(key, [session]);
  }
  const overlapped = new Set<string>();
  for (const group of byLink.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (overlaps(group[i], group[j])) {
          overlapped.add(group[i].id);
          overlapped.add(group[j].id);
        }
      }
    }
  }
  if (overlapped.size === 0) return null;
  return { code: "ZOOM_LINK_OVERLAP", sessionIds: [...overlapped] };
}
