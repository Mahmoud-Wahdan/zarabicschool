type IncomingHeaders = Headers | Record<string, unknown> | undefined;

function getHeader(headers: IncomingHeaders, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export function getClientIp(headers: IncomingHeaders) {
  return getHeader(headers, "x-forwarded-for")?.split(",")[0]?.trim()
    || getHeader(headers, "x-real-ip")
    || "unknown";
}
