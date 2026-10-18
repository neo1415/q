/**
 * Settle the q.action outbox rows that died on UNKNOWN_TYPE (DEF-A1).
 *
 *   node dist/requeue-q-action-outbox.js              # dry run: counts by type
 *   node dist/requeue-q-action-outbox.js --requeue    # attempts back to zero
 *   node dist/requeue-q-action-outbox.js --discard    # delete them instead
 *
 * Writes only against a loopback database unless
 * `--hosted-approved-by=<name>` names who approved it: hosted data changes
 * need the lead's and founder's yes, and the worker carrying Q_ACTION_EVENTS
 * must be deployed first or the rows simply die again. Prints counts only.
 * See outbox/dead-q-actions.ts for what each mode means.
 */
import { loadDatabaseConfig } from "@capital-q/config/database";
import { createRequestDatabaseClient } from "@capital-q/database";

import {
  settleDeadQActionEvents,
  writeAllowed,
  type DeadQActionMode,
} from "./outbox/dead-q-actions.js";

const args = process.argv.slice(2);
const mode: DeadQActionMode = args.includes("--requeue")
  ? "REQUEUE"
  : args.includes("--discard")
    ? "DISCARD"
    : "DRY_RUN";
const hostedApprovedBy = args
  .find((arg) => arg.startsWith("--hosted-approved-by="))
  ?.slice("--hosted-approved-by=".length);

if (args.includes("--requeue") && args.includes("--discard")) {
  process.stderr.write("refused: choose --requeue or --discard, not both\n");
  process.exit(2);
}
if (mode !== "DRY_RUN") {
  const allowed = writeAllowed({
    databaseUrl: process.env["DATABASE_URL"],
    hostedApprovedBy,
  });
  if (!allowed.ok) {
    process.stderr.write(`refused: ${allowed.reason}\n`);
    process.exit(2);
  }
}

const database = createRequestDatabaseClient(loadDatabaseConfig());
try {
  const summary = await settleDeadQActionEvents(database.sql, mode);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await database.close();
}
