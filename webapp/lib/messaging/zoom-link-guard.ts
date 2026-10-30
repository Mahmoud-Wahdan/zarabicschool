/**
 * Last line of defence before a WhatsApp send (owner, 2026-10-26 and 2026-10-31): no
 * message ever carries a raw Zoom link, whatever built the text — a session notice,
 * an Admin message or an announcement typed by hand. Each Zoom URL is replaced by the
 * session's platform join link (/api/sessions/<id>/join: checks the role and window,
 * logs the click, then redirects to Zoom) or, without a session, by a pointer to the
 * platform. Pure; never logs the text.
 */
// zoom.us / zoom.com and their subdomains, with or without a scheme. Trailing
// sentence punctuation is left outside the match.
const ZOOM_URL = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*zoom\.(?:us|com)(?![a-z0-9-])(?:[/?#][^\s]*?)?(?=[.,;:!?)\]]*(?:\s|$))/gi;

const POINTER = {
  ar: "(رابط الحصة على المنصة)",
  en: "(the session link is on the platform)",
} as const;

export function replaceRawZoomLinks(text: string, options: { platformLink: string | null; language: "ar" | "en" }): string {
  return text.replace(ZOOM_URL, () => options.platformLink ?? POINTER[options.language]);
}
