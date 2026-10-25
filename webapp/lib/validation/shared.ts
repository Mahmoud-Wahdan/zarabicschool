export const usernamePattern = /^[a-zA-Z0-9._-]+$/;

export function slugifyName(displayName: string): string | null {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return null;
  return slug.slice(0, 27);
}
