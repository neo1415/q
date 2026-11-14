import {
  defaultTreeAdapter,
  parse,
  parseFragment,
  type DefaultTreeAdapterTypes,
} from "parse5";

/**
 * SVG logos for GateQ brand from website (2026-11-14). Most company sites
 * publish their logo as SVG: an <img src="…svg"> or an inline <svg> in the
 * header's home link. A logo is only ever kept as markup rebuilt from a
 * strict allow-list, never as the site's bytes:
 *
 *   - elements: shapes, groups, gradients, clip paths, masks, symbols,
 *     same-document <use>, text, title/desc, and <style> only when it
 *     loads nothing. Anything else (script, foreignObject, image, a,
 *     animation, iframe, ...) is dropped with everything inside it.
 *   - attributes: geometry and presentation only. No event handlers, no
 *     href except a same-document "#id" on <use>, no url() except
 *     url(#id), no javascript:/data: anywhere, no CSS escapes or @import.
 *   - a DOCTYPE or entity declaration refuses the file outright.
 *   - at most 256 KB after rebuilding.
 *
 * The HTML parser (parse5, the WHATWG algorithm browsers use) reads both a
 * standalone file and a page's inline SVG the way a browser would, so
 * nothing hides in a parsing difference. Defence in depth: the result is
 * served as image/svg+xml with a sandboxing CSP and drawn only through
 * <img>, where a browser runs no script even if something slipped through.
 */

type Element = DefaultTreeAdapterTypes.Element;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export const SVG_LOGO_MAX_BYTES = 256 * 1024;
const SVG_INPUT_MAX = 1_000_000;
const MAX_DEPTH = 48;
const MAX_ELEMENTS = 10_000;
const SVG_NS = "http://www.w3.org/2000/svg";

const ELEMENTS: ReadonlySet<string> = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "title",
  "desc",
  "use",
  "symbol",
  "text",
  "tspan",
  "style",
]);
/**
 * Elements that draw something: a logo with none of these is no logo. A
 * <use> draws only what it references, which is counted where it is kept.
 */
const DRAWN: ReadonlySet<string> = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
]);
/** Elements whose text is kept (escaped); elsewhere text is dropped. */
const WITH_TEXT: ReadonlySet<string> = new Set([
  "title",
  "desc",
  "text",
  "tspan",
  "style",
]);

const ATTRIBUTES: ReadonlySet<string> = new Set([
  "id",
  "class",
  "style",
  "viewBox",
  "preserveAspectRatio",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "fr",
  "dx",
  "dy",
  "d",
  "points",
  "pathLength",
  "transform",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "color",
  "display",
  "visibility",
  "clip-path",
  "clip-rule",
  "mask",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
  "vector-effect",
  "shape-rendering",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "letter-spacing",
  "dominant-baseline",
  "role",
  "aria-label",
  "aria-hidden",
]);

const ID_REF = /^#[\w.:-]{1,200}$/u;
const SAFE_URL_REF = /url\(\s*(["']?)#[\w.:-]{1,200}\1\s*\)/giu;

/**
 * Whether a presentation value or stylesheet loads or runs nothing: url()
 * only to an element of the same image; no scheme, @import, expression(),
 * behaviour binding or CSS escape that could spell one.
 */
function inert(value: string): boolean {
  if (value.length > 200_000) return false;
  // Control characters and whitespace removed, as a CSS or URL parser
  // would skip them, before looking for a scheme or keyword.
  const squeezed = [...value]
    .filter((ch) => (ch.codePointAt(0) ?? 0) > 0x20)
    .join("")
    .toLowerCase();
  if (
    /javascript:|vbscript:|data:|@import|expression\(|behavior:|-moz-binding|\\|<|&#/u.test(
      squeezed,
    )
  ) {
    return false;
  }
  return !/url\(/iu.test(value.replace(SAFE_URL_REF, ""));
}

const escapeText = (text: string) =>
  text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
const escapeAttribute = (text: string) =>
  escapeText(text).replace(/"/gu, "&quot;");

function isElement(node: ChildNode | ParentNode): node is Element {
  return "tagName" in node;
}
const isText = (node: ChildNode): node is DefaultTreeAdapterTypes.TextNode =>
  node.nodeName === "#text";
const isTemplate = (node: Element): node is DefaultTreeAdapterTypes.Template =>
  node.tagName === "template" && "content" in node;
const isSvgElement = (node: ChildNode): node is Element =>
  isElement(node) && node.namespaceURI === SVG_NS;

/** One attribute, kept or dropped; `use` may keep a same-document href. */
function keptAttribute(
  element: Element,
  attribute: Element["attrs"][number],
): readonly [string, string] | null {
  const { name, value } = attribute;
  if (attribute.prefix !== undefined && attribute.prefix !== "") {
    // xlink:href on <use> is the old spelling of href; any other prefixed
    // attribute (xml:, xmlns:, editor metadata) is dropped.
    if (
      attribute.prefix === "xlink" &&
      name === "href" &&
      element.tagName === "use" &&
      ID_REF.test(value.trim())
    ) {
      return ["href", value.trim()];
    }
    return null;
  }
  if (name === "href") {
    return element.tagName === "use" && ID_REF.test(value.trim())
      ? ["href", value.trim()]
      : null;
  }
  if (!ATTRIBUTES.has(name)) return null;
  if (!inert(value)) return null;
  return [name, value];
}

type Budget = { elements: number; drawn: number; overflow: boolean };

function rebuild(element: Element, depth: number, budget: Budget): string {
  if (depth > MAX_DEPTH || budget.elements >= MAX_ELEMENTS) {
    // Too deep or too many parts: refused whole, never drawn cut short.
    budget.overflow = true;
    return "";
  }
  const tag = element.tagName;
  if (!ELEMENTS.has(tag)) return "";
  if (tag === "style") {
    const css = element.childNodes
      .map((child) => (isText(child) ? child.value : ""))
      .join("");
    // A stylesheet that could load or run anything is dropped whole.
    if (!inert(css)) return "";
  }
  budget.elements += 1;
  if (DRAWN.has(tag)) budget.drawn += 1;

  const seen = new Set<string>();
  const attributes: string[] = [];
  if (depth === 0) attributes.push(` xmlns="${SVG_NS}"`);
  for (const attribute of element.attrs) {
    const kept = keptAttribute(element, attribute);
    if (kept === null || seen.has(kept[0])) continue;
    seen.add(kept[0]);
    attributes.push(` ${kept[0]}="${escapeAttribute(kept[1])}"`);
  }
  if (depth === 0 && !seen.has("viewBox")) {
    // Sized but without a viewBox, an <img> would crop instead of scale.
    const size = (name: string) => {
      const raw = element.attrs.find((a) => a.name === name)?.value ?? "";
      return /^\d+(\.\d+)?(px)?$/u.test(raw.trim())
        ? Number.parseFloat(raw)
        : null;
    };
    const width = size("width");
    const height = size("height");
    if (width !== null && height !== null && width > 0 && height > 0) {
      attributes.push(` viewBox="0 0 ${width} ${height}"`);
    }
  }

  let inner = "";
  for (const child of element.childNodes) {
    if (isText(child)) {
      if (WITH_TEXT.has(tag)) inner += escapeText(child.value);
    } else if (isSvgElement(child)) {
      inner += rebuild(child, depth + 1, budget);
    }
  }
  const open = `<${tag}${attributes.join("")}`;
  return inner === "" ? `${open}/>` : `${open}>${inner}</${tag}>`;
}

export type SvgLogoResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly markup: string }
  | {
      readonly ok: false;
      /** NOT_SVG: no drawable SVG; UNSAFE: a DOCTYPE or entity declaration. */
      readonly reason: "NOT_SVG" | "UNSAFE" | "TOO_LARGE";
    };

function finish(markup: string, budget: Budget): SvgLogoResult {
  if (budget.overflow) return { ok: false, reason: "TOO_LARGE" };
  if (budget.drawn === 0) return { ok: false, reason: "NOT_SVG" };
  const bytes = new TextEncoder().encode(markup);
  if (bytes.byteLength > SVG_LOGO_MAX_BYTES) {
    return { ok: false, reason: "TOO_LARGE" };
  }
  return { ok: true, bytes, markup };
}

function firstSvg(nodes: readonly ChildNode[]): Element | null {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.namespaceURI === SVG_NS && node.tagName === "svg") return node;
    const inner = firstSvg(node.childNodes);
    if (inner !== null) return inner;
  }
  return null;
}

/** A standalone SVG file (bytes as fetched), rebuilt from the allow-list. */
export function sanitiseSvgLogo(input: Uint8Array | string): SvgLogoResult {
  if (typeof input !== "string" && input.byteLength > SVG_INPUT_MAX) {
    return { ok: false, reason: "TOO_LARGE" };
  }
  const text =
    typeof input === "string"
      ? input
      : new TextDecoder("utf-8", { fatal: false }).decode(input);
  if (text.length > SVG_INPUT_MAX) return { ok: false, reason: "TOO_LARGE" };
  // Entity declarations are how XML bombs and external entities arrive;
  // a logo has no need of one.
  if (/<!doctype|<!entity/iu.test(text)) return { ok: false, reason: "UNSAFE" };
  const root = firstSvg(parseFragment(text).childNodes);
  if (root === null) return { ok: false, reason: "NOT_SVG" };
  const budget: Budget = { elements: 0, drawn: 0, overflow: false };
  return finish(rebuild(root, 0, budget), budget);
}

/**
 * Whether stored bytes are exactly what the sanitiser produces from them:
 * the check made again each time a logo is served.
 */
export function isSanitisedSvgLogo(bytes: Uint8Array): boolean {
  if (bytes.byteLength > SVG_LOGO_MAX_BYTES) return false;
  const again = sanitiseSvgLogo(bytes);
  if (!again.ok || again.bytes.byteLength !== bytes.byteLength) return false;
  return again.bytes.every((byte, index) => byte === bytes[index]);
}

function attr(element: Element, name: string): string | null {
  return element.attrs.find((a) => a.name === name && !a.prefix)?.value ?? null;
}

function useTargets(element: Element, into: Set<string>): void {
  if (element.tagName === "use") {
    const href =
      element.attrs.find((a) => a.name === "href")?.value.trim() ?? "";
    if (ID_REF.test(href)) into.add(href.slice(1));
  }
  const id = attr(element, "id");
  if (id !== null) into.delete(id);
  for (const child of element.childNodes) {
    if (isElement(child)) useTargets(child, into);
  }
}

function idsWithin(element: Element, into: Set<string>): void {
  const id = attr(element, "id");
  if (id !== null) into.add(id);
  for (const child of element.childNodes) {
    if (isElement(child)) idsWithin(child, into);
  }
}

/**
 * An inline <svg> from a page, rebuilt from the allow-list. A sprite logo
 * (`<use href="#logo">` whose <symbol> sits elsewhere on the page) brings
 * that one symbol along, sanitised the same way.
 */
export function sanitiseInlineSvg(
  svg: Element,
  byId: ReadonlyMap<string, Element> = new Map(),
): SvgLogoResult {
  const wanted = new Set<string>();
  useTargets(svg, wanted);
  const own = new Set<string>();
  idsWithin(svg, own);
  const budget: Budget = { elements: 0, drawn: 0, overflow: false };
  let defs = "";
  for (const id of wanted) {
    const target = byId.get(id);
    if (own.has(id) || target === undefined) continue;
    if (target.namespaceURI !== SVG_NS) continue;
    defs += rebuild(target, 2, budget);
  }
  const markup = rebuild(svg, 0, budget);
  if (defs === "") return finish(markup, budget);
  const at = markup.indexOf(">");
  const selfClosing = markup[at - 1] === "/";
  const head = selfClosing ? markup.slice(0, at - 1) : markup.slice(0, at);
  const body = selfClosing ? "</svg>" : markup.slice(at + 1);
  return finish(`${head}><defs>${defs}</defs>${body}`, budget);
}

export type InlineSvgLogo = {
  readonly svg: Element;
  readonly byId: ReadonlyMap<string, Element>;
};

const normalise = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The inline <svg> a page uses as its own logo, or null. Only clear cases:
 *   - inside the header's (header, nav, role=banner/navigation) link to
 *     the site's home page; or
 *   - in the header and labelled as the logo or with the site's name
 *     (aria-label, <title>, class or id of the svg, its home link or the
 *     elements just around it).
 * Never in a footer, where partner and customer logos sit.
 */
export function findInlineSvgLogo(
  pageUrl: string,
  html: string,
  siteName: string | null,
): InlineSvgLogo | null {
  const document = parse(html.slice(0, SVG_INPUT_MAX));
  const page = new URL(pageUrl);
  const name = siteName === null ? "" : normalise(siteName);
  const byId = new Map<string, Element>();
  const svgs: Element[] = [];

  const walk = (node: ParentNode) => {
    for (const child of node.childNodes) {
      if (!isElement(child)) continue;
      const id = attr(child, "id");
      if (id !== null && !byId.has(id)) byId.set(id, child);
      if (child.namespaceURI === SVG_NS && child.tagName === "svg") {
        svgs.push(child);
        // Ids inside it are still wanted for sprites; nested svgs are not
        // candidates of their own.
        const collect = (inner: Element) => {
          for (const c of inner.childNodes) {
            if (!isElement(c)) continue;
            const cid = attr(c, "id");
            if (cid !== null && !byId.has(cid)) byId.set(cid, c);
            collect(c);
          }
        };
        collect(child);
        continue;
      }
      walk(
        isTemplate(child)
          ? defaultTreeAdapter.getTemplateContent(child)
          : child,
      );
    }
  };
  walk(document);

  const isHome = (href: string | null) => {
    if (href === null) return false;
    try {
      const url = new URL(href, page);
      if (url.host.toLowerCase() !== page.host.toLowerCase()) return false;
      const path = url.pathname.replace(/\/+$/u, "");
      return path === "" || path === page.pathname.replace(/\/+$/u, "");
    } catch {
      return false;
    }
  };
  const labelOf = (element: Element) => {
    const title = element.childNodes.find(
      (c): c is Element => isElement(c) && c.tagName === "title",
    );
    const titleText =
      title?.childNodes.map((c) => (isText(c) ? c.value : "")).join("") ?? "";
    return [
      attr(element, "aria-label"),
      attr(element, "title"),
      attr(element, "class"),
      attr(element, "id"),
      attr(element, "alt"),
      titleText,
    ]
      .filter((v): v is string => v !== null)
      .join(" ");
  };
  const labelled = (label: string) =>
    /logo/iu.test(label) ||
    (name.length >= 2 && normalise(label).includes(name));

  let fallback: InlineSvgLogo | null = null;
  for (const svg of svgs) {
    let inHeader = false;
    let inFooter = false;
    let homeLink = false;
    const labels = [labelOf(svg)];
    let hops = 0;
    for (
      let node: ParentNode | null = svg.parentNode;
      node !== null && isElement(node);
      node = node.parentNode
    ) {
      hops += 1;
      const tag = node.tagName;
      const role = (attr(node, "role") ?? "").toLowerCase();
      if (tag === "footer" || role === "contentinfo") inFooter = true;
      if (
        tag === "header" ||
        tag === "nav" ||
        role === "banner" ||
        role === "navigation"
      ) {
        inHeader = true;
      }
      if (tag === "a" && isHome(attr(node, "href"))) {
        homeLink = true;
        labels.push(labelOf(node));
      } else if (hops <= 3) {
        labels.push(labelOf(node));
      }
    }
    if (inFooter) continue;
    const named = labelled(labels.join(" "));
    if (homeLink && inHeader) return { svg, byId };
    if (fallback === null && ((homeLink && named) || (inHeader && named))) {
      fallback = { svg, byId };
    }
  }
  return fallback;
}
