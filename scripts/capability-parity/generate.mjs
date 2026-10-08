#!/usr/bin/env node
// RECOVERY-2026-10 (C6): writes the control catalog and the Capability
// Parity Matrix from the code, formatted exactly as the parity test
// expects. Deterministic: code-point order, paths from the repository
// root whatever the cwd. Run after adding or changing a control
// registration or an app action:
//
//   node scripts/capability-parity/generate.mjs
//
// Needs the app-actions package built (pnpm turbo run build --filter=@capital-q/app-actions).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { generatedFiles, REPO_ROOT } from "./lib.mjs";

const { APP_ACTIONS, PERSON_ACTIONS, qCapabilityId } = await import(
  pathToFileURL(join(REPO_ROOT, "packages/app-actions/dist/index.js")).href
);

const files = await generatedFiles(
  REPO_ROOT,
  [...APP_ACTIONS, ...PERSON_ACTIONS],
  qCapabilityId,
);
writeFileSync(files.catalog.file, files.catalog.text);
writeFileSync(files.matrix.file, files.matrix.text);
console.log(
  `capability parity: ${String(files.controls.length)} controls written`,
);
