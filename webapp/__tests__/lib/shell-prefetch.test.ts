import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * L2b (owner, 2026-10-28): every page load prefetched the whole sidebar — measured
 * 29 extra requests per Admin page (21 for a teacher). The proxy allows 120
 * requests/min per IP, so an Admin opening 4–5 pages a minute got 429 pages. The
 * shell's links (sidebar, drawer, bell, brand) no longer prefetch; a click fetches
 * the page once.
 */
describe("shell links do not prefetch (L2b)", () => {
  it("SP-01: every <Link> in the dashboard shell has prefetch={false}", () => {
    const file = join(process.cwd(), "app/_components/dashboard-shell.tsx");
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const links: { line: number; prefetchOff: boolean }[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "Link") {
        const prefetch = node.attributes.properties.find((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === "prefetch");
        const off = !!prefetch && ts.isJsxAttribute(prefetch) && prefetch.initializer?.getText(source) === "{false}";
        links.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, prefetchOff: off });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(links.length).toBeGreaterThan(2);
    expect(links.filter((link) => !link.prefetchOff)).toEqual([]);
  });
});
