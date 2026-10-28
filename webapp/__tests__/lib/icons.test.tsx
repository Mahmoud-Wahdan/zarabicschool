import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import Icon, { ICON_NAMES, iconOr, isIconName } from "../../app/_components/ui/icon";

/**
 * L2 (owner, 2026-10-28): the 3.9 MB Material Symbols icon font is gone; icons are
 * Lucide SVG components bundled with the app, nothing downloaded from outside.
 * TypeScript (`IconName`) rejects an icon name with no mapping; these checks keep the
 * font from coming back and prove every mapped name renders.
 */
const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

describe("icons (L2)", () => {
  it("IC-01: every mapped name renders an SVG hidden from screen readers", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(90);
    for (const name of ICON_NAMES) {
      const html = renderToStaticMarkup(<Icon name={name} size={18} className="x" />);
      expect(html).toMatch(/^<svg[^>]*aria-hidden="true"/);
      expect(html).toContain('width="18"');
    }
  });

  it("IC-02: no icon font is used or installed anymore", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("material-symbols");
    const hits = sources(join(ROOT, "app")).filter((file) => /material-symbols(-outlined|\/)/.test(readFileSync(file, "utf8")));
    expect(hits.map((file) => relative(ROOT, file))).toEqual([]);
  });

  it("IC-03: names from data fall back safely", () => {
    expect(isIconName("school")).toBe(true);
    expect(isIconName("not_an_icon")).toBe(false);
    expect(isIconName("constructor")).toBe(false);
    expect(iconOr("not_an_icon", "menu_book")).toBe("menu_book");
    expect(iconOr(null, "school")).toBe("school");
  });
});
