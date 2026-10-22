#!/usr/bin/env node
/**
 * Workspace closure of one service, for the container build
 * (scripts/deploy/docker-build-service.sh). Run from the repository root.
 *
 *   node scripts/deploy/workspace-closure.mjs list @capital-q/api
 *     Prints the service and every workspace package it reaches, one per
 *     line.
 *
 *   node scripts/deploy/workspace-closure.mjs link-dev @capital-q/api
 *     After a `--prod` install of that closure: links each workspace package
 *     a closure member declares only as a devDependency, and fails if a
 *     member's compiled dist imports a non-workspace devDependency.
 *
 * Why the dev edges matter: some packages import a workspace package at
 * runtime that they declare only as a devDependency (packages/model-gateway
 * imports @capital-q/q-tools, which itself depends on model-gateway, so the
 * edge cannot be a dependency without a build cycle). A `--prod` install
 * drops that link and the service fails at boot with ERR_MODULE_NOT_FOUND.
 * Railway never sees this because it installs the whole workspace.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

const root = process.cwd();
const [mode, target] = process.argv.slice(2);
if ((mode !== "list" && mode !== "link-dev") || target === undefined) {
  console.error("usage: workspace-closure.mjs <list|link-dev> <package-name>");
  process.exit(2);
}

/** @type {Map<string, {dir: string, deps: string[], devOnly: string[]}>} */
const workspace = new Map();
for (const group of ["apps", "packages"]) {
  for (const entry of readdirSync(join(root, group))) {
    const dir = join(root, group, entry);
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    const deps = Object.keys(pkg.dependencies ?? {});
    const devOnly = Object.keys(pkg.devDependencies ?? {}).filter(
      (name) => !deps.includes(name),
    );
    workspace.set(pkg.name, { dir, deps, devOnly });
  }
}

if (!workspace.has(target)) {
  console.error(`unknown workspace package: ${target}`);
  process.exit(2);
}

const isWorkspace = (name) => workspace.has(name);
const closure = new Set();
const stack = [target];
while (stack.length > 0) {
  const name = stack.pop();
  if (name === undefined || closure.has(name)) continue;
  closure.add(name);
  const node = workspace.get(name);
  if (node === undefined) continue;
  stack.push(...[...node.deps, ...node.devOnly].filter(isWorkspace));
}

if (mode === "list") {
  process.stdout.write([...closure].join("\n") + "\n");
  process.exit(0);
}

/** Every compiled .js file under a package's dist, concatenated. */
function distText(dir) {
  const out = [];
  const walk = (path) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.(c|m)?js$/.test(entry.name))
        out.push(readFileSync(child, "utf8"));
    }
  };
  walk(join(dir, "dist"));
  return out.join("\n");
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const importsOf = (text, name) =>
  new RegExp(
    `(?:from\\s*|import\\s*\\(\\s*|require\\(\\s*)["']${escape(name)}(?:["'/])`,
  ).test(text);

const problems = [];
let linked = 0;
for (const name of closure) {
  const node = workspace.get(name);
  if (node === undefined) continue;
  const text = distText(node.dir);
  for (const dev of node.devOnly) {
    if (!importsOf(text, dev)) continue;
    const devNode = workspace.get(dev);
    if (devNode === undefined) {
      problems.push(`${name} imports ${dev}, declared only as a devDependency`);
      continue;
    }
    const link = join(node.dir, "node_modules", ...dev.split("/"));
    if (existsSync(link)) continue;
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(relative(dirname(link), devNode.dir), link, "dir");
    linked += 1;
    console.log(`linked ${name} -> ${dev} (devDependency imported at runtime)`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(
    "a --prod install cannot satisfy these; declare them as dependencies",
  );
  process.exit(1);
}
console.log(
  `closure of ${target}: ${closure.size} packages, ${linked} dev links`,
);
