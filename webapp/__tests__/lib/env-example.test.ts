import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * ENV-01 (staging D95): `.env.example` lists every environment variable the app code
 * reads, by name. A staging/production env file built from it then sets every key, so
 * nothing silently falls back to a developer's `.env`. Names only — never values.
 */
const RUNTIME_ONLY = new Set(["NODE_ENV", "NEXT_RUNTIME"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

it("ENV-01: every variable read by app/, lib/, proxy, instrumentation, next.config and the worker is in .env.example", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("lib"), "proxy.ts", "instrumentation.ts", "next.config.ts", "scripts/worker.ts"];
  const used = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(match[1]);
    for (const match of source.matchAll(/\b(?:requiredEnv|required)\("([A-Z][A-Z0-9_]+)"\)/g)) used.add(match[1]);
  }
  const listed = new Set([...readFileSync(join(process.cwd(), ".env.example"), "utf8").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]));
  const missing = [...used].filter((name) => !RUNTIME_ONLY.has(name) && !listed.has(name)).sort();
  expect(missing).toEqual([]);
});
