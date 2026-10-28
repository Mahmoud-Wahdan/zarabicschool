import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

/**
 * A1 (2026-10-28): React refuses a whitespace text node inside <table>, <thead>,
 * <tbody>, <tfoot> or <tr> ("In HTML, whitespace text nodes cannot be a child of
 * <tbody>"), which breaks hydration. In JSX, whitespace on the same line between two
 * children (for example `{rows.map(...)}   </tbody>`) is such a node; whitespace that
 * contains a line break is dropped by JSX. This scans every .tsx file under app/ with
 * the TypeScript parser and fails on any kept whitespace child of those elements.
 */
const TABLE_PARTS = new Set(["table", "thead", "tbody", "tfoot", "tr"]);

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : tsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/** JSX keeps a whitespace-only text child only when it has no line break. */
const keptWhitespace = (text: string) => text.length > 0 && /^[ \t]+$/.test(text);

function findings(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(source);
      if (TABLE_PARTS.has(tag)) {
        for (const child of node.children) {
          const literal = ts.isJsxExpression(child) && child.expression && ts.isStringLiteral(child.expression) ? child.expression.text : null;
          if ((ts.isJsxText(child) && keptWhitespace(child.text)) || (literal !== null && /^\s+$/.test(literal))) {
            const { line } = source.getLineAndCharacterOfPosition(child.getStart(source));
            hits.push(`${path.relative(process.cwd(), file)}:${line + 1} <${tag}>`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe("no whitespace text nodes inside table markup (A1)", () => {
  it("the scanner catches the pattern", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-"));
    const sample = path.join(dir, "sample.tsx");
    fs.writeFileSync(sample, 'export const A = ({ r }: { r: string[] }) => <table><tbody>{r.map((x) => <tr key={x}><td>{x}</td></tr>)}   </tbody></table>;\nexport const B = () => <table><tbody>\n  <tr><td>ok</td></tr>\n</tbody></table>;\n');
    expect(findings(sample)).toHaveLength(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("no component under app/ has one", () => {
    const hits = tsxFiles(path.join(process.cwd(), "app")).flatMap(findings);
    expect(hits).toEqual([]);
  });
});
