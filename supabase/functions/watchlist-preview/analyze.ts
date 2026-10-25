// Spiegelt auto_root/parse_html aus check.py: gleiche Kandidaten und Schwelle.
export const CANDIDATES = ["main", "article", "[role=main]", "#main-content", "#content"];
export const MIN_SHARE = 0.2;

type El = { textContent: string | null; remove(): void };
export type Doc = {
  title?: string;
  querySelector(sel: string): El | null;
  querySelectorAll(sel: string): Iterable<El>;
  documentElement: El;
};

const clean = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

export type Preview = {
  title: string;
  total: number;
  mode: "auto" | "selector" | "page";
  selector: string | null;
  found: boolean;
  chars: number;
  sample: string;
  candidates: { selector: string; chars: number }[];
};

export function analyze(doc: Doc, selector: string): Preview {
  const title = clean(doc.title ?? "");
  for (const el of Array.from(doc.querySelectorAll("script, style, noscript, svg"))) el.remove();
  const total = clean(doc.documentElement.textContent).length;
  const candidates = CANDIDATES.flatMap((sel) => {
    const node = doc.querySelector(sel);
    return node ? [{ selector: sel, chars: clean(node.textContent).length }] : [];
  });
  const sel = selector.trim();
  const base = { title, total, candidates };
  const text = (node: El) => clean(node.textContent);
  if (sel === "auto") {
    const hit = candidates.find((c) => total > 0 && c.chars >= total * MIN_SHARE);
    if (hit) {
      const node = doc.querySelector(hit.selector)!;
      return { ...base, mode: "auto", selector: hit.selector, found: true, chars: hit.chars, sample: text(node).slice(0, 300) };
    }
    return { ...base, mode: "auto", selector: null, found: true, chars: total, sample: text(doc.documentElement).slice(0, 300) };
  }
  if (sel) {
    let node: El | null = null;
    try {
      node = doc.querySelector(sel);
    } catch {
      /* ungültiger Selector zählt als nicht gefunden */
    }
    return node
      ? { ...base, mode: "selector", selector: sel, found: true, chars: text(node).length, sample: text(node).slice(0, 300) }
      : { ...base, mode: "selector", selector: sel, found: false, chars: 0, sample: "" };
  }
  return { ...base, mode: "page", selector: null, found: true, chars: total, sample: text(doc.documentElement).slice(0, 300) };
}
