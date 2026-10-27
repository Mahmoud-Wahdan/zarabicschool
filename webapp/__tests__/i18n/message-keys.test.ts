import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Message-key safety net (owner, 2026-10-27). (1) en and ar carry exactly the same
 * keys. (2) Every literal key a component asks for exists: for each translator bound
 * with `useTranslations("ns")` / `getTranslations("ns")` (also `{ namespace: "ns" }`
 * and `const [a, b] = await Promise.all([getTranslations("x"), …])`), each
 * `t("key")` call must resolve to `ns.key` in the catalog. Dynamic keys (template
 * strings, variables) are out of scope. Found by this test: S-05 put `phoneCol` /
 * `whatsappChat` under `management` while the panel reads `management.form`.
 */
type Catalog = Record<string, unknown>;

const ROOT = process.cwd();
const en = JSON.parse(readFileSync(join(ROOT, "messages/en.json"), "utf8")) as Catalog;
const ar = JSON.parse(readFileSync(join(ROOT, "messages/ar.json"), "utf8")) as Catalog;

function flatten(node: Catalog, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? flatten(value as Catalog, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

function hasKey(catalog: Catalog, key: string): boolean {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return false;
    node = (node as Catalog)[part];
  }
  return node !== undefined;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const TRANSLATOR = /(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)"|\{[^}]*namespace:\s*"([^"]*)"[^}]*\})?\s*\)/;

/** Translator variable → namespace ("" = root) for one source file. */
function translators(source: string): Map<string, string> {
  const vars = new Map<string, string>();
  const single = new RegExp(String.raw`const\s+(\w+)\s*=\s*(?:await\s+)?` + TRANSLATOR.source, "g");
  for (const match of source.matchAll(single)) vars.set(match[1], match[2] ?? match[3] ?? "");
  for (const match of source.matchAll(/const\s*\[([^\]]+)\]\s*=\s*await\s+Promise\.all\(\[([\s\S]*?)\]\)/g)) {
    const names = match[1].split(",").map((name) => name.trim());
    const calls = match[2].split(/,(?![^(]*\))/).map((part) => part.match(TRANSLATOR));
    names.forEach((name, index) => {
      const call = calls[index];
      if (name && call) vars.set(name, call[1] ?? call[2] ?? "");
    });
  }
  return vars;
}

function missingKeys(): string[] {
  const missing: string[] = [];
  for (const file of [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib"))]) {
    const source = readFileSync(file, "utf8");
    for (const [name, namespace] of translators(source)) {
      const call = new RegExp(String.raw`(?<![\w.])${name}(?:\.rich|\.markup|\.raw)?\(\s*"([^"]+)"`, "g");
      for (const match of source.matchAll(call)) {
        const key = namespace ? `${namespace}.${match[1]}` : match[1];
        for (const [locale, catalog] of [["en", en], ["ar", ar]] as const) {
          if (!hasKey(catalog, key)) missing.push(`${relative(ROOT, file)} → ${locale}:${key}`);
        }
      }
    }
  }
  return [...new Set(missing)];
}

describe("i18n message keys", () => {
  it("I18N-01: en and ar have exactly the same keys", () => {
    const enKeys = new Set(flatten(en));
    const arKeys = new Set(flatten(ar));
    expect([...enKeys].filter((key) => !arKeys.has(key))).toEqual([]);
    expect([...arKeys].filter((key) => !enKeys.has(key))).toEqual([]);
  });

  it("I18N-02: the scanner binds translators correctly (self-check)", () => {
    const vars = translators(
      'const t = useTranslations("a.b");\nconst [x, y] = await Promise.all([getTranslations("c"), getTranslations({ locale, namespace: "d" })]);',
    );
    expect(Object.fromEntries(vars)).toEqual({ t: "a.b", x: "c", y: "d" });
  });

  it("I18N-03: every literal t(\"key\") in app/ and lib/ exists in both catalogs", () => {
    expect(missingKeys()).toEqual([]);
  });
});
