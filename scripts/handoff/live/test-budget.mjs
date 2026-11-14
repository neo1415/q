// Shared engineering-test cost ledger (owner directive 14 Nov 2026, corrected):
// at most $1 estimated per live test or evaluation run, at most $5 per UTC day
// across all paid providers, shared by every parallel worker on this machine.
// Ceilings, not targets. Prefer free, mocked and deterministic tests.
//
//   node scripts/handoff/live/test-budget.mjs status
//   node scripts/handoff/live/test-budget.mjs reserve <usd> "<label>"   (prints an id, or exits 3)
//   node scripts/handoff/live/test-budget.mjs record <id> <actualUsd> "<outcome>"
//   node scripts/handoff/live/test-budget.mjs note <usd> "<label>"      (spend already incurred)
//
// The ledger lives outside the repository (CQ_TEST_LEDGER, default
// ~/.cq-test-ledger.jsonl); an exclusive lock file makes a reservation atomic
// across concurrent workers. A reservation counts at its estimate until it is
// recorded with its actual cost. Charges incurred through Capital Q's own model
// routing count: a live product turn is not free.
import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const PER_TEST_USD = 1;
const PER_DAY_USD = 5;
const FILE = process.env.CQ_TEST_LEDGER ?? `${homedir()}/.cq-test-ledger.jsonl`;
const LOCK = `${FILE}.lock`;
const today = new Date().toISOString().slice(0, 10);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(fn) {
  for (let attempt = 0; attempt < 200; attempt++) {
    let fd;
    try {
      fd = openSync(LOCK, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      sleep(50);
      continue;
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      unlinkSync(LOCK);
    }
  }
  throw new Error("ledger lock busy");
}

function rows() {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function spentToday() {
  const all = rows().filter((row) => row.day === today);
  const recorded = new Map(
    all
      .filter((row) => row.kind === "record")
      .map((row) => [row.id, row.actualUsd]),
  );
  let total = 0;
  for (const row of all) {
    if (row.kind === "reserve")
      total += recorded.has(row.id) ? recorded.get(row.id) : row.estimateUsd;
    if (row.kind === "note") total += row.usd;
  }
  return Math.round(total * 10000) / 10000;
}

function append(entry) {
  appendFileSync(
    FILE,
    `${JSON.stringify({ day: today, at: new Date().toISOString(), ...entry })}\n`,
  );
}

const [command, a, b, c] = process.argv.slice(2);
if (command === "status") {
  const spent = spentToday();
  console.log(
    JSON.stringify({
      day: today,
      spentUsd: spent,
      remainingUsd: Math.max(
        0,
        Math.round((PER_DAY_USD - spent) * 10000) / 10000,
      ),
      perTestCapUsd: PER_TEST_USD,
      perDayCapUsd: PER_DAY_USD,
    }),
  );
} else if (command === "reserve") {
  const estimate = Number(a);
  if (!(estimate > 0)) {
    console.error("the estimate must be a positive number of USD");
    process.exit(2);
  }
  if (estimate > PER_TEST_USD) {
    console.error(
      `refused: $${estimate} exceeds the $${PER_TEST_USD} per-test cap; scale the test down`,
    );
    process.exit(3);
  }
  withLock(() => {
    const spent = spentToday();
    if (spent + estimate > PER_DAY_USD) {
      console.error(
        `refused: $${spent} spent today + $${estimate} would exceed the $${PER_DAY_USD} daily cap`,
      );
      process.exit(3);
    }
    const id = randomUUID();
    append({ kind: "reserve", id, estimateUsd: estimate, label: b ?? "" });
    console.log(id);
  });
} else if (command === "record") {
  withLock(() =>
    append({ kind: "record", id: a, actualUsd: Number(b), outcome: c ?? "" }),
  );
  console.log("recorded");
} else if (command === "note") {
  withLock(() => append({ kind: "note", usd: Number(a), label: b ?? "" }));
  console.log("noted");
} else {
  console.error(
    "usage: status | reserve <usd> <label> | record <id> <actualUsd> <outcome> | note <usd> <label>",
  );
  process.exit(2);
}
