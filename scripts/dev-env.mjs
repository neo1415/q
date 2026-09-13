#!/usr/bin/env node
/* global process, console, URL */
/**
 * Local development preload for the Node services (api, q-api, workers).
 *
 *   node --watch --import ../../scripts/dev-env.mjs src/main.ts
 *
 * `pnpm dev` runs each service from its TypeScript source with this module
 * preloaded. It does two dev-only things and nothing else:
 *
 * 1. Loads the repository-root `.env.local` (gitignored; see `.env.example`)
 *    into the process, so local configuration reaches every service without
 *    anyone exporting variables by hand. Variables already present in the
 *    environment win, exactly as Node's own `--env-file` behaves, so a shell
 *    override still works. A production NODE_ENV refuses to load anything.
 *    Only the file's presence is logged; values never appear anywhere.
 *    (`process.loadEnvFile` rather than `--env-file`: the flag does not
 *    resolve relative paths reliably on every Windows setup, and this module
 *    can resolve the repository root from its own location.)
 *
 * 2. Resolves the `./x.js` specifiers the sources use (the ESM convention tsc
 *    emits against) to `./x.ts` while running uncompiled TypeScript. Node's
 *    type stripping does not rewrite extensions. The hook applies only to a
 *    relative specifier imported FROM a `.ts` file whose `.js` target does
 *    not exist and whose `.ts` sibling does, so package `dist/` output and
 *    node_modules resolve exactly as before.
 *
 * The web app is not wired here: Next.js loads `apps/web/.env.local` itself.
 * `start` and every deployed process run compiled `dist/` output with
 * platform-supplied configuration and never load this module.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const envFile = resolve(root, ".env.local");

if (process.env.NODE_ENV === "production") {
  console.error(
    "dev-env: refusing to load .env.local under NODE_ENV=production",
  );
} else if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
  console.error("dev-env: loaded .env.local");
} else {
  console.error(
    "dev-env: no .env.local at the repository root; see .env.example",
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    if (
      typeof parent === "string" &&
      parent.startsWith("file:") &&
      parent.endsWith(".ts") &&
      /^\.\.?\//.test(specifier) &&
      specifier.endsWith(".js")
    ) {
      const jsPath = resolve(dirname(fileURLToPath(parent)), specifier);
      const tsPath = `${jsPath.slice(0, -3)}.ts`;
      if (!existsSync(jsPath) && existsSync(tsPath)) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
