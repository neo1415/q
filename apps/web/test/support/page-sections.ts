import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lane W / Q Workspace W2: reads the web app's pages from source -- the
 * page file and the modules it imports from this app (`@/...` and
 * relative), a few levels deep -- for the manifest coverage tests. A page
 * renders what it imports, so a registration in an imported component
 * counts for the page.
 */

export const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const APP = join(WEB, "app");
export const SRC = join(WEB, "src");

export const REGISTERS =
  /<QSection\b|\buseQSection\(|<QPageState\b|\buseQDialog\(|\bregisterQSection\(|\bregisterQDialog\(/u;

/** Import depth followed from a page: page -> screen -> section is 2. */
export const DEPTH = 4;

export function walkPages(dir: string = APP, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkPages(path, out);
    else if (name === "page.tsx") out.push(path);
  }
  return out;
}

/** The route key: app-relative, route groups `(x)` dropped. */
export function routeKey(file: string): string {
  return relative(APP, file)
    .split("/")
    .filter((part) => !/^\(.+\)$/u.test(part))
    .join("/");
}

/** The route pattern of a page file ("company/[companyId]/page.tsx" -> "/company/[companyId]"). */
export function routeOf(file: string): string {
  const key = routeKey(file).replace(/\/?page\.tsx$/u, "");
  return `/${key}`;
}

const IMPORT = /\bfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gu;

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (base === null) return null;
  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const sourceOf = new Map<string, string>();
export function read(file: string): string {
  let text = sourceOf.get(file);
  if (text === undefined) {
    text = readFileSync(file, "utf8");
    sourceOf.set(file, text);
  }
  return text;
}

/** The page file and the app modules it imports, to DEPTH, in breadth-first order. */
export function pageTree(file: string): readonly string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  let frontier = [file];
  for (let depth = 0; depth <= DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const one of frontier) {
      if (seen.has(one)) continue;
      seen.add(one);
      order.push(one);
      const text = read(one);
      for (const match of text.matchAll(IMPORT)) {
        const spec = match[1] ?? match[2];
        if (spec === undefined) continue;
        const target = resolveImport(one, spec);
        // The manifest's own modules define the calls; they show nothing.
        if (target !== null && !target.includes("/features/q/q-section")) {
          next.push(target);
        }
      }
    }
    frontier = next;
  }
  return order;
}

export function registers(file: string): boolean {
  return pageTree(file).some((one) => REGISTERS.test(read(one)));
}

/**
 * Components that forward their `id` prop to a QSection: a tag of one of
 * these with a literal id registers that id.
 */
const FORWARDING = [
  "QSection",
  "ProfileTabQSection",
  "ProfileOpenTabQSection",
  "ProfileSectionShell",
  "EditableSection",
  "AnswersKvSection",
] as const;

/** The text of a JSX opening tag from `start` (at `<`), braces balanced. */
function openingTag(text: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (depth > 0 && (char === '"' || char === "'" || char === "`")) {
      quote = char;
    } else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return text.slice(start, index + 1);
  }
  return text.slice(start);
}

/** The value of attribute `name` in an opening tag: a literal, or a `{...}` expression. */
function attribute(tag: string, name: string): string | null {
  const at = tag.search(new RegExp(`\\s${name}=`, "u"));
  if (at < 0) return null;
  const rest = tag.slice(at + name.length + 2);
  if (rest.startsWith('"')) return rest.slice(0, rest.indexOf('"', 1) + 1);
  if (!rest.startsWith("{")) return null;
  let depth = 0;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "{") depth += 1;
    else if (rest[index] === "}") {
      depth -= 1;
      if (depth === 0) return rest.slice(0, index + 1);
    }
  }
  return rest;
}

const ID_LITERAL = /["']([a-z][a-z0-9_-]{0,47})["']/gu;

/** The section ids one source file registers, literal ids only. */
export function sectionIdsIn(text: string): readonly string[] {
  const ids = new Set<string>();
  for (const name of FORWARDING) {
    const tag = new RegExp(`<${name}\\b`, "gu");
    for (const match of text.matchAll(tag)) {
      const value = attribute(openingTag(text, match.index), "id");
      if (value === null) continue;
      for (const literal of value.matchAll(ID_LITERAL)) {
        if (literal[1] !== undefined) ids.add(literal[1]);
      }
    }
  }
  for (const match of text.matchAll(
    /\buseQSection\(\s*["']([a-z][a-z0-9_-]{0,47})["']/gu,
  )) {
    if (match[1] !== undefined) ids.add(match[1]);
  }
  return [...ids].sort();
}

/** Every literal section id a page registers, itself or through what it imports. */
export function pageSectionIds(file: string): readonly string[] {
  const ids = new Set<string>();
  for (const one of pageTree(file)) {
    for (const id of sectionIdsIn(read(one))) ids.add(id);
  }
  return [...ids].sort();
}
