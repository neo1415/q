import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Structural secret and SDK boundaries (CQ-Q-005 §26, §64, §80; doc 23
 * §126). Asserted over the source tree rather than at runtime, because
 * the property is "no such code exists", and never by comparing a real
 * key: the assertions are about NAMES and IMPORTS only.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SOURCE_DIRS = ["apps", "packages"];
const SKIP = new Set(["node_modules", "dist", ".next", ".turbo", "generated"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if ([...EXTENSIONS].some((ext) => full.endsWith(ext))) {
      yield full;
    }
  }
}

const files = SOURCE_DIRS.flatMap((d) => [...walk(join(ROOT, d))]).map((f) => ({
  path: relative(ROOT, f).replace(/\\/g, "/"),
  text: readFileSync(f, "utf8"),
}));

const SDK_IMPORT =
  /from\s+["'](@google\/genai|groq-sdk|openai|@anthropic-ai\/[^"']+)(\/[^"']*)?["']/;
const KEY_NAMES = /\b(GEMINI_API_KEY|GROQ_API_KEY)\b/;
const ENV_READ =
  /process\.env\.(GEMINI_API_KEY|GROQ_API_KEY)|process\.env\[["'](GEMINI_API_KEY|GROQ_API_KEY)["']\]/;

describe("model provider boundaries", () => {
  it("imports provider SDKs only inside the Model Gateway's adapter files", () => {
    const offenders = files
      .filter((f) => SDK_IMPORT.test(f.text))
      .map((f) => f.path)
      .filter((p) => !p.startsWith("packages/model-gateway/src/providers/"));
    expect(offenders).toEqual([]);
  });

  it("keeps the credential names out of browser-reachable code and public contracts", () => {
    const offenders = files
      .filter(
        (f) =>
          f.path.startsWith("apps/web/") ||
          f.path.startsWith("packages/ui/") ||
          f.path.startsWith("packages/api-client/") ||
          f.path.startsWith("packages/contracts/"),
      )
      .filter((f) => KEY_NAMES.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("reads the credentials from the process environment in the config package only", () => {
    const offenders = files
      .filter((f) => ENV_READ.test(f.text))
      .map((f) => f.path)
      // The live smoke suite is the explicit opt-in runner and reads them by design.
      .filter(
        (p) =>
          !p.startsWith("packages/config/") && !p.endsWith(".live.test.ts"),
      );
    expect(offenders).toEqual([]);
  });

  it("never prefixes a provider key as a public variable", () => {
    const offenders = files
      .filter((f) => /NEXT_PUBLIC_[A-Z_]*(GEMINI|GROQ)[A-Z_]*_KEY/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("exposes no provider or model selector on the public Q request contract", () => {
    const request = files.find(
      (f) => f.path === "packages/contracts/src/q/request.ts",
    );
    expect(request).toBeDefined();
    const fields = (request?.text ?? "").match(/^\s*[A-Za-z]+\??:/gm) ?? [];
    expect(fields.map((f) => f.trim())).not.toContainEqual(
      expect.stringMatching(/^(provider|model|modelCode|providerCode)/i),
    );
  });
});
