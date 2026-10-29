import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Lane W (2026-10-15), "Q should always be able to see exactly what is on
 * screen": every page of the web app tells Q what it shows -- it registers
 * at least one manifest section (QSection, useQSection, QPageState or a
 * dialog), itself or through a component it renders -- or it is exempt
 * here with the reason Q has nothing to read there. A new page that is
 * neither fails, so a screen cannot ship that Q is blind to.
 *
 * Read from the source, like the route-capability parity test: the page
 * file and the modules it imports from this app (`@/...` and relative),
 * a few levels deep. Importing a registering component counts, because a
 * page renders what it imports.
 */

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(WEB, "app");
const SRC = join(WEB, "src");

const REGISTERS =
  /<QSection\b|\buseQSection\(|<QPageState\b|\buseQDialog\(|\bregisterQSection\(|\bregisterQDialog\(/u;

/** Import depth followed from a page: page -> screen -> section is 2. */
const DEPTH = 4;

const OPERATIONS_CONSOLE =
  "Capital Q's operations console (ADR 0033): platform operators, not a tenant's screen; Q is not offered there";
const DEV =
  "development preview harness (app/dev), not a product surface; fixtures only";
const PUBLIC =
  "public or anonymous surface: no signed-in Q session to send a manifest from";
const AUTH = "sign-in and account recovery: no Q session before sign-in";
const ONBOARDING =
  "onboarding runs its own Q loop (ADR 0016) with the step and its answers as context, not the page manifest";
const CALLBACK = "provider callback or redirect: nothing is shown to read";
const REDIRECT =
  "a redirect only: it renders nothing; the page it sends to registers";

/** Whole route trees exempt, by prefix. */
const EXEMPT_TREES: Readonly<Record<string, string>> = {
  "admin/": OPERATIONS_CONSOLE,
  "dev/": DEV,
};

const EXEMPT: Readonly<Record<string, string>> = {
  "page.tsx": "the public landing page: signed out, no Q session",
  "paused/page.tsx":
    "the account-paused notice: Q is switched off for a paused account",
  "auth/check-email/page.tsx": AUTH,
  "auth/forgot-password/page.tsx": AUTH,
  "auth/sign-in/page.tsx": AUTH,
  "auth/sign-up/page.tsx": AUTH,
  "auth/update-password/page.tsx": AUTH,
  "connected/google/page.tsx": CALLBACK,
  "settings/reconnect/google/page.tsx": CALLBACK,
  "settings/billing/page.tsx":
    "an old address: it redirects to Plan and billing, which registers its own section",
  "g/[publicId]/page.tsx": PUBLIC,
  "g/[publicId]/embed/page.tsx": PUBLIC,
  "u/[handle]/page.tsx": PUBLIC,
  "onboarding/founder/page.tsx": ONBOARDING,
  "onboarding/investor/page.tsx": ONBOARDING,
  "crm/page.tsx": REDIRECT,
  // Capital is the CRM's Capital tab (owner 2026-10-16).
  "capital/page.tsx": REDIRECT,
  "find/page.tsx": REDIRECT,
  "gateway/page.tsx": REDIRECT,
  "results/page.tsx": REDIRECT,
  "discover/yours/page.tsx": REDIRECT,
  "investors/[investorOrganisationId]/rehearse/page.tsx": REDIRECT,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name === "page.tsx") out.push(path);
  }
  return out;
}

/** The route key: app-relative, route groups `(x)` dropped. */
function routeKey(file: string): string {
  return relative(APP, file)
    .split("/")
    .filter((part) => !/^\(.+\)$/u.test(part))
    .join("/");
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
function read(file: string): string {
  let text = sourceOf.get(file);
  if (text === undefined) {
    text = readFileSync(file, "utf8");
    sourceOf.set(file, text);
  }
  return text;
}

function registers(file: string): boolean {
  const seen = new Set<string>();
  let frontier = [file];
  for (let depth = 0; depth <= DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const one of frontier) {
      if (seen.has(one)) continue;
      seen.add(one);
      const text = read(one);
      if (REGISTERS.test(text)) return true;
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
  return false;
}

const pages = walk(APP).sort();

describe("every page tells Q what it shows (lane W)", () => {
  it("finds the pages", () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it("registers a manifest section, or is exempt with a reason", () => {
    const blind: string[] = [];
    for (const page of pages) {
      const key = routeKey(page);
      if (Object.keys(EXEMPT_TREES).some((tree) => key.startsWith(tree))) {
        continue;
      }
      if (EXEMPT[key] !== undefined) continue;
      if (!registers(page)) blind.push(key);
    }
    expect(blind).toEqual([]);
  });

  it("keeps no stale exemption: each names a page that exists and does not register", () => {
    const keys = new Set(pages.map(routeKey));
    for (const [tree, reason] of Object.entries(EXEMPT_TREES)) {
      expect(
        [...keys].some((key) => key.startsWith(tree)),
        tree,
      ).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(keys.has(key), key).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
      const page = pages.find((one) => routeKey(one) === key);
      if (page !== undefined) expect(registers(page), key).toBe(false);
    }
  });
});
