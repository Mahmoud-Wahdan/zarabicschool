import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * A4 (owner, 2026-10-28): text unreadable on the dark navy fill (the selected period
 * tab on the admin revenue chart). Cause: `a { color: inherit }` in globals.css was
 * NOT in a cascade layer. Tailwind v4 puts utilities in `@layer utilities`, and an
 * unlayered rule beats every layered one, so `text-on-primary` on a link lost to the
 * inherited dark body text. Fixed at the base level (element rules in `@layer base`)
 * and the colour tokens audited for WCAG AA (4.5:1 for text).
 */
const ROOT = process.cwd();
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");

/** The CSS with every `@layer … { … }` block removed (brace matched). */
function unlayered(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const at = text.indexOf("@layer", index);
    if (at < 0) return out + text.slice(index);
    out += text.slice(index, at);
    const open = text.indexOf("{", at);
    const semicolon = text.indexOf(";", at);
    if (semicolon >= 0 && semicolon < open) {
      index = semicolon + 1; // `@layer a, b;` order statement
      continue;
    }
    let depth = 0;
    let cursor = open;
    for (; cursor < text.length; cursor++) {
      if (text[cursor] === "{") depth++;
      if (text[cursor] === "}" && --depth === 0) break;
    }
    index = cursor + 1;
  }
  return out;
}

function tokens(): Record<string, string> {
  const start = css.indexOf(":root");
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((match) => [match[1], match[2].toLowerCase()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** Every string and template-literal piece in a file (class lists live in these). */
function stringLiterals(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return out;
}

describe("colour contrast at the token level (A4)", () => {
  it("CT-01: element rules (a, body, headings, *) are in @layer base, so utilities can override them", () => {
    const rest = unlayered(css).replace(/\/\*[\s\S]*?\*\//g, "");
    const elementRules = [...rest.matchAll(/(^|})\s*([^{}@]+)\{/g)]
      .map((match) => match[2].trim())
      .filter((selector) => selector.split(",").some((part) => /^(\*|a|body|html|h[1-6]|button|input|select|textarea)$/.test(part.trim())));
    expect(elementRules).toEqual([]);
  });

  it("CT-02: every designed text/background token pair reaches 4.5:1", () => {
    const t = tokens();
    const pairs: [string, string][] = [
      ["on-primary", "primary"], ["on-primary-container", "primary-container"], ["on-primary-fixed", "primary-fixed"],
      ["on-secondary", "secondary"], ["on-secondary-container", "secondary-container"], ["on-secondary-fixed", "secondary-fixed"],
      ["on-tertiary", "tertiary"], ["on-tertiary-container", "tertiary-container"], ["on-tertiary-fixed", "tertiary-fixed"],
      ["on-error", "error"], ["on-error-container", "error-container"],
      ["on-background", "background"], ["on-background", "surface-bright"],
      ["on-surface-variant", "surface-container-lowest"], ["on-surface-variant", "surface-container-high"], ["on-surface-variant", "surface-container-highest"],
      ["outline", "surface-container-lowest"], ["outline", "surface-container-low"], ["outline", "surface-container"], ["outline", "surface-container-high"], ["outline", "background"],
      ["inverse-on-surface", "inverse-surface"],
      ["emerald", "surface"], ["emerald", "background"], ["surface", "emerald"], ["navy", "background"], ["foreground", "background"],
      ["success", "success-surface"], ["warning", "warning-surface"], ["danger", "danger-surface"], ["system-info", "system-info-surface"],
      ["content", "canvas"], ["content-secondary", "canvas"], ["content-secondary", "surface"],
    ];
    const failing = pairs
      .map(([text, background]) => {
        if (!t[text] || !t[background]) return `${text} on ${background}: token missing`;
        const ratio = contrast(t[text], t[background]);
        return ratio < 4.5 ? `${text} (${t[text]}) on ${background} (${t[background]}): ${ratio.toFixed(2)}` : null;
      })
      .filter(Boolean);
    expect(failing).toEqual([]);
  });

  it("CT-03: every element that sets a token background and a token text colour reaches 4.5:1", () => {
    // Opaque token utilities only: `bg-x/20` (translucent) and arbitrary values are skipped.
    const t = tokens();
    const themed = Object.fromEntries([...css.matchAll(/--color-([a-z0-9-]+):\s*var\(--([a-z0-9-]+)\)/g)].map((match) => [match[1], t[match[2]]]));
    expect(Object.keys(themed).length).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const file of tsxFiles(join(ROOT, "app"))) {
      const source = readFileSync(file, "utf8");
      for (const literal of stringLiterals(file, source).filter((text) => /\bbg-[a-z]/.test(text))) {
        const byVariant = new Map<string, { bg?: string; text?: string }>();
        for (const name of literal.split(/\s+/)) {
          const colon = name.lastIndexOf(":");
          const variant = colon < 0 ? "" : name.slice(0, colon + 1);
          const utility = name.slice(colon + 1);
          const entry = byVariant.get(variant) ?? {};
          const bg = utility.match(/^bg-([a-z-]+)$/)?.[1];
          const text = utility.match(/^text-([a-z-]+)$/)?.[1];
          if (bg && themed[bg]) entry.bg = bg;
          if (text && themed[text]) entry.text = text;
          byVariant.set(variant, entry);
        }
        const base = byVariant.get("") ?? {};
        for (const [variant, entry] of byVariant) {
          const bg = entry.bg ?? base.bg;
          const text = entry.text ?? base.text;
          if (!bg || !text) continue;
          const ratio = contrast(themed[bg], themed[text]);
          if (ratio < 4.5) hits.push(`${relative(ROOT, file)}: ${variant}bg-${bg} + text-${text} = ${ratio.toFixed(2)}`);
        }
      }
    }
    expect([...new Set(hits)]).toEqual([]);
  });

  it("CT-04: a focusable control with outline-none keeps a visible focus style", () => {
    // With the global :focus-visible outline in @layer base, `outline-none` now really
    // removes it, so the same class list must bring its own focus/focus-visible style.
    // A tabIndex={-1} container (the mobile nav dialog) is focused by script only.
    const hits: string[] = [];
    for (const file of tsxFiles(join(ROOT, "app"))) {
      const source = readFileSync(file, "utf8");
      for (const literal of stringLiterals(file, source).filter((text) => /(^|\s)outline-none(\s|$)/.test(text))) {
        if (/(^|\s)focus(-visible|-within)?:[^\s]*(ring|outline|border|stroke|shadow)/.test(literal)) continue;
        const at = source.indexOf(literal);
        if (at >= 0 && source.slice(Math.max(0, at - 300), at).includes("tabIndex={-1}")) continue;
        hits.push(`${relative(ROOT, file)}: "${literal}"`);
      }
    }
    expect(hits).toEqual([]);
  });
});
