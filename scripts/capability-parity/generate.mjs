#!/usr/bin/env node
// RECOVERY-2026-10 (C6): writes the control catalog and the Capability
// Parity Matrix from the code. Run after adding or changing a control
// registration or an app action:
//
//   node scripts/capability-parity/generate.mjs
//
// Needs the app-actions package built (pnpm turbo run build --filter=@capital-q/app-actions).

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  collectControls,
  kindActs,
  pageRoutes,
  renderCatalog,
  renderMatrix,
} from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { APP_ACTIONS, PERSON_ACTIONS, qCapabilityId } = await import(
  pathToFileURL(join(root, "packages/app-actions/dist/index.js")).href
);

const controls = collectControls(root);
const actions = [...APP_ACTIONS, ...PERSON_ACTIONS]
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
  .sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(
  join(root, "packages/q-tools/src/tools/control-catalog.ts"),
  renderCatalog(controls),
);
writeFileSync(
  join(root, "docs/recovery/capability-parity.md"),
  renderMatrix({
    controls,
    pages: pageRoutes(root),
    actions,
    acts: kindActs(root),
  }),
);
console.log(
  `capability parity: ${String(controls.length)} controls, ${String(actions.length)} actions`,
);
