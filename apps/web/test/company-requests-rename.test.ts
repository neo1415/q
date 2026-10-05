import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * "Founder's request" is now "Company requests" everywhere a person or Q
 * says it (founder brief B4, ADR 0052): the screens, the sidebar, Q's
 * tool words and the capability text. This greps the source so the old
 * label cannot come back.
 *
 * Scanned: the web app, the Q tools, the app actions, the Q API and the
 * specialists. Not scanned: published prompt versions in q-core, which are
 * immutable once locked (a new version would carry the new words), and
 * provenance notes ("founder request 2026-10-02" means the founder asked
 * for something; it is not the label). The founder's own side still
 * sends "a Connection Request"; only the investor's list is renamed.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SCANNED = [
  "apps/web/src",
  "apps/web/app",
  "packages/q-tools/src",
  "packages/app-actions/src",
  "apps/q-api/src",
  "packages/q-specialists/src",
];
const OLD = /Founder requests|founder's request\b|founders' requests/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "node_modules" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("Company requests (B4 rename)", () => {
  it("no screen, nav, Q word or capability still says Founder requests", () => {
    const hits = SCANNED.flatMap((dir) =>
      files(join(ROOT, dir)).flatMap((path) =>
        readFileSync(path, "utf8")
          .split("\n")
          .map((line, i) => [line, i] as const)
          .filter(([line]) => OLD.test(line))
          .map(
            ([line, i]) =>
              `${relative(ROOT, path)}:${String(i + 1)}: ${line.trim()}`,
          ),
      ),
    );
    expect(hits).toEqual([]);
  });

  it("the sidebar and the page say Company requests", () => {
    const nav = readFileSync(
      join(ROOT, "apps/web/src/components/app-shell/navigation.ts"),
      "utf8",
    );
    expect(nav).toContain('label: "Company requests"');
    const page = readFileSync(
      join(ROOT, "apps/web/app/(app)/investors/page.tsx"),
      "utf8",
    );
    expect(page).toContain('title="Company requests"');
  });
});
