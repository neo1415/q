import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Context Firewall (release-blocking): the founder's readiness is
 * founder-private and must never shape investor-facing ranking,
 * discoverability or assessment. Structurally: only the apps' composition
 * and the app's own action registry (the founder's own routes and tools)
 * may import this package. Discovery, recommendations, ranking, matching
 * and every investor-facing package must not.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ALLOWED = new Set(["readiness", "app-actions", "q-tools"]);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("readiness firewall", () => {
  it("no package outside the founder's own surfaces imports @capital-q/readiness", () => {
    const offenders: string[] = [];
    for (const pkg of readdirSync(join(ROOT, "packages"))) {
      if (ALLOWED.has(pkg)) continue;
      const src = join(ROOT, "packages", pkg, "src");
      let files: string[] = [];
      try {
        files = sources(src);
      } catch {
        continue;
      }
      for (const file of files) {
        if (readFileSync(file, "utf8").includes("@capital-q/readiness")) {
          offenders.push(file.slice(ROOT.length));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
