// W4-A (enterprise audit 21 Nov 2026, finding 6): first-load JS per route,
// read from a finished `next build` (Turbopack), and a budget it may not
// grow past.
//
//   node scripts/bundle-budget.mjs            measure and check against bundle-budget.json
//   node scripts/bundle-budget.mjs --write    measure and write bundle-budget.json
//   node scripts/bundle-budget.mjs --report   measure, print the table and the heaviest chunks
//
// First-load JS of a route = the root main files and polyfills, plus every
// chunk its client-reference manifest names for the route's layouts and
// page (entryJSFiles). Sizes are uncompressed bytes, as the audit counted;
// gzip is printed beside them. A route's budget is its measured size plus
// a small allowance (BUDGET_SLACK_BYTES) for chunk-hash noise; a route that
// grows past it fails, and the fix is to split the import, not to raise
// the number (raise it only with a recorded reason).
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative } from "node:path";
import { runInNewContext } from "node:vm";

const WEB = join(import.meta.dirname, "..");
const NEXT = join(WEB, ".next");
const BUDGET = join(WEB, "bundle-budget.json");
const BUDGET_SLACK_BYTES = 8 * 1024;

function manifests(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(manifests(path));
    else if (name === "page_client-reference-manifest.js") out.push(path);
  }
  return out;
}

const sizeCache = new Map();
function size(file) {
  if (!sizeCache.has(file)) {
    const bytes = readFileSync(join(NEXT, file));
    sizeCache.set(file, { raw: bytes.length, gzip: gzipSync(bytes).length });
  }
  return sizeCache.get(file);
}

export function measure() {
  const build = JSON.parse(
    readFileSync(join(NEXT, "build-manifest.json"), "utf8"),
  );
  const root = [...build.rootMainFiles, ...build.polyfillFiles];
  const routes = {};
  const chunkRoutes = new Map();
  const appDir = join(NEXT, "server", "app");
  for (const path of manifests(appDir)) {
    const sandbox = { globalThis: {} };
    sandbox.globalThis = sandbox;
    runInNewContext(readFileSync(path, "utf8"), sandbox);
    const all = sandbox.__RSC_MANIFEST;
    const key = Object.keys(all)[0];
    const manifest = all[key];
    // The route's own chain: the root layout, each group/segment layout on
    // the way, and the page (error/loading/not-found boundaries load on
    // demand, as Next counts them).
    const route = key.replace(/\/page$/u, "") || "/";
    const pageEntry = `[project]/apps/web/app${key}`;
    const chain = Object.keys(manifest.entryJSFiles).filter((entry) => {
      if (entry === pageEntry) return true;
      if (!entry.endsWith("/layout")) return false;
      const dir = entry.slice(
        "[project]/apps/web/app".length,
        -"/layout".length,
      );
      return route === dir || route.startsWith(`${dir}/`) || dir === "";
    });
    const files = new Set(root);
    for (const entry of chain)
      for (const f of manifest.entryJSFiles[entry]) files.add(f);
    let raw = 0;
    let gzip = 0;
    for (const f of files) {
      const s = size(f);
      raw += s.raw;
      gzip += s.gzip;
      chunkRoutes.set(f, (chunkRoutes.get(f) ?? 0) + 1);
    }
    routes[route === "" ? "/" : route] = { raw, gzip, chunks: files.size };
  }
  return { routes, chunkRoutes };
}

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;

const mode = process.argv[2] ?? "--check";
const { routes, chunkRoutes } = measure();
const names = Object.keys(routes).sort();
if (mode === "--report") {
  const raws = names.map((n) => routes[n].raw).sort((a, b) => a - b);
  console.log(
    `routes ${names.length}; median first-load ${kb(raws[Math.floor(raws.length / 2)])}; max ${kb(raws.at(-1))}`,
  );
  for (const n of names)
    console.log(
      `${kb(routes[n].raw).padStart(8)} ${kb(routes[n].gzip).padStart(7)} gz  ${n}`,
    );
  console.log("\nheaviest chunks (raw, routes that load them):");
  const heavy = [...chunkRoutes.entries()]
    .sort((a, b) => size(b[0]).raw - size(a[0]).raw)
    .slice(0, 25);
  for (const [f, count] of heavy)
    console.log(
      `${kb(size(f).raw).padStart(8)}  ${String(count).padStart(3)} routes  ${f}`,
    );
  process.exit(0);
}
if (mode === "--write") {
  const budget = Object.fromEntries(
    names.map((n) => [n, routes[n].raw + BUDGET_SLACK_BYTES]),
  );
  writeFileSync(
    BUDGET,
    `${JSON.stringify({ unit: "bytes, uncompressed first-load JS", routes: budget }, null, 2)}\n`,
  );
  console.log(`wrote ${relative(WEB, BUDGET)} for ${names.length} routes`);
  process.exit(0);
}
const budget = JSON.parse(readFileSync(BUDGET, "utf8")).routes;
const over = names.filter(
  (n) => budget[n] !== undefined && routes[n].raw > budget[n],
);
const unbudgeted = names.filter((n) => budget[n] === undefined);
for (const n of over)
  console.error(`over budget: ${n} ${kb(routes[n].raw)} > ${kb(budget[n])}`);
for (const n of unbudgeted)
  console.error(
    `no budget: ${n} ${kb(routes[n].raw)} (run with --write once, and say why)`,
  );
if (over.length + unbudgeted.length > 0) process.exit(1);
console.log(`bundle budget: ${names.length} routes within budget`);
