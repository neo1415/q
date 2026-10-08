// RECOVERY-2026-10 (workstream C, C6): the Capability Parity Matrix and
// the control catalog, generated from the code itself -- the control ids
// pages register, the web pages, and the declared app actions -- so the
// matrix can never claim a control the app does not have, nor miss one.
//
// Used by scripts/capability-parity/generate.mjs (writes the files) and
// by apps/q-api/test/route-capability-parity.test.ts (fails when the files
// on disk are stale or a control has no Q capability).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = ["apps/web/src", "apps/web/app"];

/**
 * Code-point order: the same on every machine and locale (localeCompare
 * ordered "section.action-plan" and "section.actions" differently by ICU
 * locale, so the generator and the test disagreed across machines).
 */
export function byCodePoint(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The repository root, from this file's own location (never the cwd). */
export const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** The app actions as matrix rows, in code-point order by name. */
export function actionRows(actions, qCapabilityId) {
  return actions
    .map((action) => ({
      name: action.name,
      classification: action.classification,
      capability: qCapabilityId(action),
      route:
        action.http === undefined
          ? null
          : `${action.http.method} ${action.http.path}`,
      does: action.does,
    }))
    .sort((a, b) => byCodePoint(a.name, b.name));
}

/**
 * Both generated files, exactly as they belong on disk: rendered, then
 * formatted with the repository's own prettier config, so what the
 * generator writes is what the parity test expects, byte for byte.
 */
export async function generatedFiles(root, actions, qCapabilityId) {
  const prettier = await import("prettier");
  const format = async (text, file) =>
    prettier.format(text, {
      ...((await prettier.resolveConfig(file)) ?? {}),
      filepath: file,
    });
  const controls = collectControls(root);
  const catalogFile = join(
    root,
    "packages/q-tools/src/tools/control-catalog.ts",
  );
  const matrixFile = join(root, "docs/recovery/capability-parity.md");
  return {
    controls,
    catalog: {
      file: catalogFile,
      text: await format(renderCatalog(controls), catalogFile),
    },
    matrix: {
      file: matrixFile,
      text: await format(
        renderMatrix({
          controls,
          pages: pageRoutes(root),
          actions: actionRows(actions, qCapabilityId),
          acts: kindActs(root),
        }),
        matrixFile,
      ),
    },
  };
}

/** The id prefixes and their kinds, read from the registry itself. */
export function controlPrefixes(root) {
  const text = readFileSync(
    join(root, "apps/web/src/features/q/control/registry.ts"),
    "utf8",
  );
  const block = text.slice(
    text.indexOf("export const CONTROL_PREFIX"),
    text.indexOf("};", text.indexOf("export const CONTROL_PREFIX")),
  );
  const out = {};
  for (const match of block.matchAll(/^\s*([a-z]+): "([A-Z_]+)",$/gmu)) {
    out[match[1]] = match[2];
  }
  return out;
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "node_modules" || name === "dev" ? [] : files(path);
    }
    return /\.(ts|tsx)$/u.test(name) && !/\.test\.(ts|tsx)$/u.test(name)
      ? [path]
      : [];
  });
}

/** Components that register `section.<their id>` for every literal id given. */
const SECTION_FACTORIES = ["PageSection", "SettingsCard"];

/**
 * Every control id registered in source, as a string literal in a file that
 * registers controls, or as the id of a section factory. Ids built at run
 * time cannot be listed and so cannot be registered (the registry's ids
 * are literal by rule, q-control.tsx).
 */
export function collectControls(root) {
  const prefixes = controlPrefixes(root);
  const names = Object.keys(prefixes).join("|");
  const literal = new RegExp(
    `["'\`]((?:${names})\\.[a-z0-9][a-z0-9_-]{0,47})["'\`]`,
    "gu",
  );
  const found = new Map();
  const add = (id, file) => {
    const kind = prefixes[id.split(".")[0]];
    const entry = found.get(id) ?? { id, kind, sources: new Set() };
    entry.sources.add(file);
    found.set(id, entry);
  };
  for (const base of WEB) {
    for (const path of files(join(root, base))) {
      const file = relative(root, path).split("\\").join("/");
      // The registry's own module names ids in its documentation only.
      if (file.startsWith("apps/web/src/features/q/control/")) continue;
      // Ids in comments are not registrations.
      const text = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/^\s*\/\/.*$/gmu, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "");
      if (/control\/q-control"|useQControl|<QControl\b/u.test(text)) {
        for (const match of text.matchAll(literal)) add(match[1], file);
      }
      for (const factory of SECTION_FACTORIES) {
        const call = new RegExp(
          `<${factory}\\b[^>]*?\\bid="([a-z0-9][a-z0-9_-]{0,47})"`,
          "gsu",
        );
        for (const match of text.matchAll(call))
          add(`section.${match[1]}`, file);
      }
    }
  }
  return [...found.values()]
    .map((entry) => ({ ...entry, sources: [...entry.sources].sort() }))
    .sort((a, b) => byCodePoint(a.id, b.id));
}

/** The web app's pages (signed-in routes), as the parity test reads them. */
export function pageRoutes(root) {
  const appDir = join(root, "apps/web/app");
  const pages = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "page.tsx") pages.push(path);
    }
  };
  walk(appDir);
  return pages
    .map((page) => ({
      route:
        "/" +
        relative(appDir, dirname(page))
          .split("\\")
          .join("/")
          .split("/")
          .filter((segment) => !/^\(.*\)$/u.test(segment) && segment !== "")
          .join("/"),
      file: relative(root, page).split("\\").join("/"),
    }))
    .sort((a, b) => byCodePoint(a.route, b.route));
}

/** The acts each kind takes (the web registry's KIND_ACTS, read from source). */
export function kindActs(root) {
  const text = readFileSync(
    join(root, "apps/web/src/features/q/control/registry.ts"),
    "utf8",
  );
  const start = text.indexOf("export const KIND_ACTS");
  const block = text.slice(start, text.indexOf("};", start));
  const out = {};
  for (const match of block.matchAll(/^\s*([A-Z_]+): \[([^\]]*)\],?$/gmu)) {
    out[match[1]] = [...match[2].matchAll(/"([A-Z_]+)"/gu)].map((m) => m[1]);
  }
  return out;
}

const VERIFY = {
  TAB: "aria-selected on the tab, and for a link tab the router settled on its route",
  SECTION: "the section is inside the viewport",
  LIST: "SELECT_ITEM: the route changed, a dialog opened, or the item shows selected/current/open; an item with nothing to open is in view",
  LIST_ITEM: "the route changed, a dialog opened, or its state moved",
  BUTTON: "the route changed, a dialog opened, or its own state moved",
  MENU: "aria-expanded is the state asked for",
  DISCLOSURE: "aria-expanded (or <details open>) is the state asked for",
  FILTER: "the page's own handler confirms its filter shows (effectShown)",
  TOGGLE: "aria-pressed / aria-checked is the value asked for",
  INPUT: "document.activeElement is the input",
  DIALOG: "the dialog is gone after its own close control",
  CAROUSEL: "the page's own handler confirms the step (effectShown)",
};

/** The control catalog the operate_screen tool resolves targets against. */
export function renderCatalog(controls) {
  const rows = controls
    .map(
      (control) =>
        `  { id: ${JSON.stringify(control.id)}, kind: ${JSON.stringify(control.kind)} },`,
    )
    .join("\n");
  return `// GENERATED by scripts/capability-parity/generate.mjs -- do not edit.
// RECOVERY-2026-10 (C2/C6): every control id the web app registers, with its
// kind (its id's prefix). operate_screen resolves a target against these
// (and, when the run carries it, the controls on screen now).

export type QControlCatalogEntry = {
  readonly id: string;
  readonly kind:
    | "TAB"
    | "SECTION"
    | "LIST"
    | "LIST_ITEM"
    | "BUTTON"
    | "MENU"
    | "DISCLOSURE"
    | "FILTER"
    | "TOGGLE"
    | "INPUT"
    | "DIALOG"
    | "CAROUSEL";
};

export const Q_CONTROL_CATALOG: readonly QControlCatalogEntry[] = [
${rows}
];
`;
}

const cell = (text) =>
  String(text).replaceAll("|", "\\|").replaceAll("\n", " ");

/** The matrix (docs/recovery/capability-parity.md). */
export function renderMatrix({ controls, pages, actions, acts }) {
  const lines = [];
  lines.push(
    "# Capability Parity Matrix (generated)",
    "",
    "GENERATED by `node scripts/capability-parity/generate.mjs` from the code: the control ids the web app registers, its pages, and the declared app actions. Do not edit by hand; `apps/q-api/test/route-capability-parity.test.ts` fails when this file is stale or a control has no Q capability.",
    "",
    "Risk classes: reading and navigation run directly; consequential actions are prepared for approval with the exact payload; destructive actions show the exact target.",
    "",
    `## 1. Page controls (${controls.length})`,
    "",
    "Every control is operated by `operate_screen` (tool.operate_screen): typed text and voice alike. Authorization: the person's own Q conversation (OWN_Q_CONVERSATION); the act runs through the page's own element or handler, changes no server state, and a DONE receipt is sent only once the page shows the effect.",
    "",
    "| Control id | Kind (entity) | Args (acts) | Cross-page | Chainable | Confirmation | Verification (DONE only when) | Failure | Test | Registered in |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const control of controls) {
    lines.push(
      `| \`${control.id}\` | ${control.kind} | target=\`${control.id}\`; act ∈ {${(acts[control.kind] ?? []).join(", ")}}${control.kind === "LIST" ? "; index (1-based)" : ""}${control.kind === "TOGGLE" ? "; value on/off" : ""}${control.kind === "FILTER" ? "; value code" : ""} | yes: after open_page / NAVIGATE the act waits for the new page | yes: one queue, each step after the last receipt | none (screen act) | ${cell(VERIFY[control.kind] ?? "")} | TARGET_MISSING / NOT_APPLICABLE / FAILED receipt; shell notice; receipt fact next turn | apps/web/test/q-control.test.tsx | ${control.sources.map((s) => `\`${s}\``).join(", ")} |`,
    );
  }
  lines.push(
    "",
    `## 2. Pages (${pages.length})`,
    "",
    "Reached by `NAVIGATE` (fixed route map, apps/web/src/features/voice/destinations.ts) or `open_page` (a record, by server-resolved id). Moves are confirmed when the router settles on the route; a move that never lands is FAILED. Each page's coverage or stated exemption is in the parity test's PAGE_COVERAGE.",
    "",
    "| Route | Page file | Controls registered in this page file |",
    "| --- | --- | --- |",
  );
  for (const page of pages) {
    const own = controls.filter((control) =>
      control.sources.includes(page.file),
    );
    lines.push(
      `| \`${page.route}\` | \`${page.file}\` | ${own.length === 0 ? "—" : own.map((c) => `\`${c.id}\``).join(", ")} |`,
    );
  }
  lines.push(
    "",
    `## 3. App actions (${actions.length})`,
    "",
    "Each declaration generates its HTTP route and its Q tool (ADR 0040), so the screen and Q are one capability. CONSEQUENTIAL: Prepare → Approve (exact payload, idempotency key) → Execute; Q's DONE comes from the action's own result after it ran. INSTANT/READ: run at the person's word.",
    "",
    "| Action | Class | Q capability | Route | Does |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const action of actions) {
    lines.push(
      `| \`${action.name}\` | ${action.classification} | ${action.capability === null ? "—" : `\`${action.capability}\``} | ${action.route === null ? "—" : `\`${action.route}\``} | ${cell(action.does)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
