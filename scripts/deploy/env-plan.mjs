/**
 * Env-file handling shared by fly-deploy.mjs and vercel-deploy.mjs.
 *
 * Reads a service's env file (exported from Railway), drops what belongs to
 * Railway, and rewrites the cross-service addresses to the new hosts. Values
 * are held only to hand them to the host's API; nothing here prints one.
 * Callers print names.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export const DEFAULT_WEB_ORIGIN = "https://capital-q-web.vercel.app";

/**
 * Reads NAME=value lines into a Map. Supports `export NAME=value`, comments,
 * single or double quotes and fly's NAME="""multi-line""" form. A malformed
 * line is reported by number only, never by content.
 */
export function readEnvFile(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  /** @type {Map<string, string>} */
  const entries = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/^\s*export\s+/, "");
    if (/^\s*(#|$)/.test(line)) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match === null) {
      throw new Error(`${path}:${i + 1}: not NAME=value (line not shown)`);
    }
    const [, name, rest] = match;
    let value = rest.trim();
    if (value.startsWith('"""')) {
      const parts = [value.slice(3)];
      while (!parts[parts.length - 1].endsWith('"""')) {
        i += 1;
        if (i >= lines.length) {
          throw new Error(`${path}: unterminated """ for ${name}`);
        }
        parts.push(lines[i]);
      }
      value = parts.join("\n").slice(0, -3);
    } else if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    entries.set(name, value);
  }
  return entries;
}

/**
 * The address each rewritten key takes on the new hosts.
 *
 * Internal URLs become the public https origins too: Fly's private
 * `.internal` addresses do not wake a stopped machine, Vercel has no private
 * network to Fly, and packages/config accepts plain-http internal URLs only
 * on Railway's private network.
 */
export function hostMap({ webOrigin, apiOrigin, qApiOrigin }) {
  return {
    CQ_WEB_ORIGIN: webOrigin,
    CQ_API_URL: apiOrigin,
    CQ_API_INTERNAL_URL: apiOrigin,
    CQ_Q_API_URL: qApiOrigin,
    CQ_Q_API_INTERNAL_URL: qApiOrigin,
    API_PUBLIC_URL: apiOrigin,
    Q_API_PUBLIC_URL: qApiOrigin,
  };
}

/**
 * Addresses each service must have even when its env file lacks them.
 * Derived from what each app reads (docs/ai-handoff/FLY-DEPLOY.md).
 */
const REQUIRED_ADDRESSES = {
  web: ["CQ_WEB_ORIGIN", "CQ_API_URL", "CQ_Q_API_URL"],
  api: ["CQ_WEB_ORIGIN", "CQ_Q_API_URL", "API_PUBLIC_URL"],
  "q-api": ["CQ_WEB_ORIGIN", "CQ_API_URL", "Q_API_PUBLIC_URL"],
  workers: ["CQ_WEB_ORIGIN"],
};

/**
 * Railway-only names: every RAILWAY_* key and PORT (each app takes the port
 * its fly.toml or Vercel sets).
 */
const isRailwayOnly = (name) => name.startsWith("RAILWAY_") || name === "PORT";

/**
 * Turns a Railway env file into the variables for the new host.
 * Returns the final entries plus the names dropped, rewritten and added.
 */
export function planEnv(service, source, hosts) {
  const map = hostMap(hosts);
  const entries = new Map();
  const dropped = [];
  const rewritten = [];
  const added = [];
  for (const [name, value] of source) {
    if (isRailwayOnly(name)) {
      dropped.push(name);
    } else if (name in map) {
      entries.set(name, map[name]);
      rewritten.push(name);
    } else {
      entries.set(name, value);
    }
  }
  for (const name of REQUIRED_ADDRESSES[service] ?? []) {
    if (!entries.has(name)) {
      entries.set(name, map[name]);
      added.push(name);
    }
  }
  // q-api builds invite and meeting-recap links from this bare host
  // (apps/q-api/src/main.ts prepends https://). The name is Railway's but no
  // longer Railway-injected, so it is set from the web origin rather than
  // dropped; without it those emails carry no link to the app.
  if (service === "q-api") {
    entries.set(
      "RAILWAY_SERVICE__CAPITAL_Q_WEB_URL",
      new URL(hosts.webOrigin).host,
    );
    added.push("RAILWAY_SERVICE__CAPITAL_Q_WEB_URL");
  }
  return { entries, dropped, rewritten, added };
}

/** True when `path` is inside the repository rooted at `repoRoot`. */
export function insideRepo(repoRoot, path) {
  const real = existsSync(path) ? realpathSync(path) : resolve(path);
  const rel = relative(realpathSync(repoRoot), real);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

/** Validates an origin flag: https, no path. */
export function parseOrigin(flag, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${flag}: not a URL`);
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search !== "") {
    throw new Error(`${flag}: expected an https origin such as https://host`);
  }
  return url.origin;
}

/** One-line summary of a plan, names only. */
export function describePlan({ entries, dropped, rewritten, added }) {
  const list = (names) => (names.length === 0 ? "none" : names.join(", "));
  return [
    `    dropped (${dropped.length}): ${list(dropped)}`,
    `    rewritten to new hosts: ${list(rewritten)}`,
    `    added: ${list(added)}`,
    `    total to set: ${entries.size}`,
  ].join("\n");
}
