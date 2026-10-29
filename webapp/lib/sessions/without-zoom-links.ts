/**
 * B5 (2026-10-29): session rows sent to a client never carry a Zoom link. Joining goes
 * only through /api/sessions/:id/join (role + window check, click log); staff read the
 * current links for editing from GET /api/sessions/:id/link. `hasHostLink` tells the
 * staff UI whether a host link exists without revealing it.
 */
export function withoutZoomLinks<T extends { zoomJoinUrl: string; zoomHostUrl: string | null }>(
  row: T,
): Omit<T, "zoomJoinUrl" | "zoomHostUrl"> & { hasHostLink: boolean } {
  const copy: Partial<T> = { ...row };
  delete copy.zoomJoinUrl;
  delete copy.zoomHostUrl;
  return { ...(copy as Omit<T, "zoomJoinUrl" | "zoomHostUrl">), hasHostLink: row.zoomHostUrl !== null };
}
