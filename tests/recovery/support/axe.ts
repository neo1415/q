import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

/**
 * axe-core without a new dependency. axe-core 4.13.0 is already in the
 * lockfile as a transitive dependency, but not a direct one, so a normal
 * resolve fails. Request G-R6 asks the lead to add it as a root
 * devDependency; until then the pnpm store path is used, and a missing copy
 * fails the test loudly rather than skipping the check.
 */
function axeSource(): string {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve("axe-core/axe.min.js");
  } catch {
    const store = resolve(import.meta.dirname, "../../../node_modules/.pnpm");
    const dir = existsSync(store)
      ? readdirSync(store).find((name) => name.startsWith("axe-core@"))
      : undefined;
    const file =
      dir === undefined ? undefined : resolve(store, dir, "node_modules/axe-core/axe.min.js");
    if (file === undefined || !existsSync(file)) {
      throw new Error("axe-core is not installed (request G-R6)");
    }
    return file;
  }
}

export type AxeViolation = {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly nodes: readonly { readonly target: readonly string[] }[];
};

/** WCAG 2.0/2.1/2.2 A and AA rules on the current page. */
export async function axe(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: axeSource() });
  return page.evaluate(async () => {
    const runner = (window as unknown as {
      axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: unknown[] }> };
    }).axe;
    const result = await runner.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations as never;
  });
}

export function summarise(violations: readonly AxeViolation[]): string {
  return violations
    .map((v) => `${v.impact ?? "?"} ${v.id}: ${v.help} (${String(v.nodes.length)}) e.g. ${v.nodes[0]?.target.join(" ") ?? ""}`)
    .join("\n");
}
