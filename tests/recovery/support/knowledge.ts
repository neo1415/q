import { call } from "./http.js";
import { localSql } from "./local-db.js";
import { vendorRequestsSince, type VendorRequest } from "./script.js";

/**
 * Workstream K (persistent knowledge and instant answers), Tests 1–7:
 * shared observations. Everything here reads the LOCAL stack only: the
 * fake vendor's request log (how many model calls a turn made, and what
 * they carried), the run as q-api reports it (server timestamps), and the
 * local database for fixtures.
 *
 * BUDGETS: TRACKING section K names no numbers, so these are G's proposal
 * from the production baseline (docs/recovery/evidence/K-baseline.md:
 * typed answers p50 13.6 s, cards p50 11.5 s, 2 model calls a turn) and the
 * founder's "instant" bar. Server time is completedAt − createdAt; browser
 * time is send → first rendered card. The lead confirms or changes them in
 * one place, here.
 */
export const BUDGET = {
  /** "three fintech companies": a code-built answer, no analyst model call. */
  discoverServerMs: 2_000,
  discoverFirstCardBrowserMs: 3_000,
  /** "what is my mandate": recalled from Tier B, no analyst model call. */
  recallServerMs: 1_500,
  /** Turns that still use the analyst (page and reference questions): server overhead around an instant fake model. */
  analystServerMs: 3_000,
  /** At most one model call (the turn reader) on a fast-path turn. */
  fastPathModelCalls: 1,
} as const;

export type ModelCalls = {
  /** Model calls the turn made (background memory extraction excluded). */
  readonly total: number;
  readonly tasks: readonly string[];
  /** COMPANY_ANALYST calls: the slow path K removes for discovery and recall. */
  readonly analyst: number;
  readonly requests: readonly VendorRequest[];
};

/** Work a finished run does after it answered; not part of the turn. */
const BACKGROUND = new Set(["MEMORY_EXTRACTOR"]);

/** Responses API calls, by prompt template (TASK: X). Embeddings are not model turns. */
export function modelCallsOf(all: readonly VendorRequest[]): ModelCalls {
  const requests = all.filter(
    (request) =>
      request.vendor === "openai" &&
      request.path.endsWith("/responses") &&
      !BACKGROUND.has(taskOf(request)),
  );
  const tasks = requests.map(taskOf);
  return {
    total: requests.length,
    tasks,
    analyst: tasks.filter((task) => task === "COMPANY_ANALYST").length,
    requests,
  };
}

export async function modelCallsSince(mark: number): Promise<ModelCalls> {
  return modelCallsOf(await vendorRequestsSince(mark));
}

function taskOf(request: VendorRequest): string {
  return /TASK: ([A-Z_]+)\b/u.exec(request.input ?? "")?.[1] ?? "(untemplated)";
}

export type RunView = {
  readonly runId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly conversationId?: string;
  readonly messages?: ReadonlyArray<{
    role: string;
    text?: string;
    blocks?: ReadonlyArray<{ kind: string; cards?: Card[] }>;
  }>;
  readonly results?: ReadonlyArray<{ kind: string; cards?: Card[] }>;
};
export type Card = {
  readonly key: string;
  readonly name?: string;
  readonly subject?: { companyId?: string } | null;
};

export async function readRun(email: string, runId: string): Promise<RunView> {
  const reply = await call(email, "q-api", "GET", `/v1/q/runs/${runId}`);
  return reply.body as RunView;
}

/** completedAt − createdAt, from the server's own clock; null while open. */
export function serverMs(run: RunView): number | null {
  if (run.completedAt === undefined) return null;
  return Date.parse(run.completedAt) - Date.parse(run.createdAt);
}

/** Canonical company ids on the run's ANSWER_CARDS (results and stored Q messages). */
export function cardCompanyIds(run: RunView): string[] {
  const blocks = [
    ...(run.results ?? []),
    ...(run.messages ?? [])
      .filter((message) => message.role === "Q")
      .flatMap((message) => message.blocks ?? []),
  ].filter((block) => block.kind === "ANSWER_CARDS");
  const ids = blocks
    .flatMap((block) => block.cards ?? [])
    .map((card) => card.subject?.companyId ?? card.key);
  return [...new Set(ids)];
}

export function answerText(run: RunView): string {
  return (run.messages ?? [])
    .filter((message) => message.role === "Q")
    .map((message) => message.text ?? "")
    .join("\n");
}

/** The newest run in the person's newest conversation (a browser turn's run). */
export async function newestRun(email: string): Promise<RunView | null> {
  const list = await call(email, "q-api", "GET", "/v1/q/conversations");
  const items = (
    (
      list.body as {
        items?: Array<{ conversationId: string; lastMessageAt: string }>;
      }
    ).items ?? []
  ).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  const newest = items[0];
  if (newest === undefined) return null;
  const one = await call(
    email,
    "q-api",
    "GET",
    `/v1/q/conversations/${newest.conversationId}`,
  );
  const runIds = (
    (one.body as { messages?: Array<{ runId?: string }> }).messages ?? []
  )
    .map((message) => message.runId)
    .filter((id): id is string => typeof id === "string");
  const last = runIds.at(-1);
  return last === undefined ? null : readRun(email, last);
}

// --- fixtures: the LOCAL seed's declared fintech companies -------------------

const FINTECH = `with recursive f as (
  select id from taxonomy.nodes where canonical_code = 'fintech'
  union select n.id from taxonomy.nodes n join f on n.parent_node_id = f.id)`;

/**
 * Companies DECLARED fintech (an ACTIVE taxonomy assignment to fintech or a
 * descendant): the canonical answer set. Prose that mentions fintech is not
 * a declaration, so it does not count.
 */
export function declaredFintech(): string[] {
  const out = localSql(
    `${FINTECH} select distinct entity_id from taxonomy.entity_assignments
     where entity_type = 'COMPANY' and status = 'ACTIVE' and node_id in (select id from f)
     order by entity_id`,
  );
  return out === "" ? [] : out.split("\n");
}

/**
 * Leaves only the first `keep` declared fintech companies declared, by
 * superseding the others' fintech assignments in the LOCAL database, and
 * returns the restore. Seeds the 0/1/2-company cases through the harness,
 * never production. This writes the source table directly, so a Tier B
 * projection that only rebuilds on product events (D, Part 5) will not see
 * it; that is G-R9 (a rebuild hook for fixtures), requested from D.
 */
export function keepDeclaredFintech(keep: number): () => void {
  const all = declaredFintech();
  const hide = all.slice(keep);
  if (hide.length === 0) return () => undefined;
  const list = hide.map((id) => `'${assertUuid(id)}'`).join(",");
  const out = localSql(
    `${FINTECH} update taxonomy.entity_assignments
       set status = 'SUPERSEDED', valid_to = clock_timestamp()
     where entity_type = 'COMPANY' and status = 'ACTIVE'
       and entity_id in (${list}) and node_id in (select id from f)
     returning id`,
  );
  const ids = out.split("\n").filter(Boolean).map(assertUuid);
  return () => {
    if (ids.length === 0) return;
    localSql(
      `update taxonomy.entity_assignments set status = 'ACTIVE', valid_to = null
       where id in (${ids.map((id) => `'${id}'`).join(",")})`,
    );
  };
}

/** The mandate's declared sectors, by display name (to restore after a change). */
export function mandateSectorNames(mandateId: string): string[] {
  const out = localSql(
    `select n.display_name from taxonomy.mandate_preferences p
       join taxonomy.nodes n on n.id = p.node_id
     where p.mandate_id = '${assertUuid(mandateId)}' and not p.is_exclusion
     order by n.display_name`,
  );
  return out === "" ? [] : out.split("\n");
}

function assertUuid(value: string): string {
  if (!/^[0-9a-f-]{36}$/u.test(value)) throw new Error("not a uuid");
  return value;
}

/** Card company id → displayed name, from the run's ANSWER_CARDS. */
export function cardNames(run: RunView): Map<string, string> {
  const blocks = [
    ...(run.results ?? []),
    ...(run.messages ?? []).flatMap((message) => message.blocks ?? []),
  ].filter((block) => block.kind === "ANSWER_CARDS");
  return new Map(
    blocks
      .flatMap((block) => block.cards ?? [])
      .map(
        (card) =>
          [card.subject?.companyId ?? card.key, card.name ?? ""] as const,
      ),
  );
}

/**
 * The person's next settled run after `previousRunId` (null: any): a
 * browser turn's run, read back from the server once it has finished.
 */
export async function nextSettledRun(
  email: string,
  previousRunId: string | null,
  timeoutMs = 90_000,
): Promise<RunView> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await newestRun(email);
    if (
      run !== null &&
      run.runId !== previousRunId &&
      run.completedAt !== undefined
    )
      return run;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("no new settled run: the turn never finished on the server");
}

/** A run body as q-api returned it, checked for the fields the tests read. */
export function asRun(value: unknown): RunView {
  const record = value as {
    runId?: unknown;
    status?: unknown;
    createdAt?: unknown;
  } | null;
  if (
    record === null ||
    typeof record.runId !== "string" ||
    typeof record.status !== "string" ||
    typeof record.createdAt !== "string"
  )
    throw new Error("not a Q run body");
  return value as RunView;
}
