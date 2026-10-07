import type { QSilenceFocus, QSilenceThing } from "@capital-q/contracts";
import { companiesInOutcome } from "@capital-q/model-gateway/q";
import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

/**
 * Q room W4b: the subject of a wait, by name ("Looking at Ledgerline's
 * deck…"), resolved on the server from the run's own tool calls.
 *
 * A name comes only from a tool call that SUCCEEDED for this run: it was
 * offered to the run, its arguments validated, the tool's own authorize
 * allowed this actor under this plan, and its output passed its schema.
 * A company the actor may not see is denied before it executes, so it
 * never yields a name here. Nothing a browser sends (a page subject, an
 * id) is ever read: no name means the ladder's generic wording.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const GET_COMPANY = "company.get";
const DOCUMENT_READS: ReadonlySet<string> = new Set([
  "company.data_room.document.read",
  "company.data_room.document.pages.read",
]);
const DECK = /\b(?:deck|pitch)\b/iu;

type RunEntry = {
  readonly tenantId: string;
  readonly userId: string;
  /** Distinct companies the run's tools returned, id → name, in order. */
  readonly companies: Map<string, string>;
  /** The company a profile read was for, most recent. */
  profiled: string | null;
  /** Company id → what of theirs was read (a deck, a document). */
  readonly things: Map<string, QSilenceThing>;
};

export type RunSubjects = {
  /** The port, observed: every outcome is noted, nothing else changes. */
  readonly observe: (port: QToolPort) => QToolPort;
  readonly note: (
    proposal: Pick<QToolProposal, "arguments">,
    context: Pick<QToolExecutionContext, "runId" | "actor" | "plan">,
    outcome: QToolCallOutcome,
  ) => void;
  /** The wait's subject for this run and this actor, or null. */
  readonly focusFor: (
    runId: string,
    actor: Pick<ActorContext, "tenantId" | "userId">,
  ) => QSilenceFocus | null;
};

function argument(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function createRunSubjects(limit = 500): RunSubjects {
  const runs = new Map<string, RunEntry>();

  const entryFor = (
    runId: string,
    actor: Pick<ActorContext, "tenantId" | "userId">,
  ): RunEntry => {
    const existing = runs.get(runId);
    if (existing !== undefined) return existing;
    const created: RunEntry = {
      tenantId: actor.tenantId,
      userId: actor.userId,
      companies: new Map(),
      profiled: null,
      things: new Map(),
    };
    runs.set(runId, created);
    if (runs.size > limit) {
      const oldest = runs.keys().next().value;
      if (oldest !== undefined) runs.delete(oldest);
    }
    return created;
  };

  const note: RunSubjects["note"] = (proposal, context, outcome) => {
    if (outcome.status !== "SUCCEEDED" || !outcome.result.ok) return;
    const entry = runs.get(context.runId);
    // A run is bound to the actor of its first noted call; a call for
    // anyone else on the same run id is ignored, never merged.
    if (
      entry !== undefined &&
      (entry.tenantId !== context.actor.tenantId ||
        entry.userId !== context.actor.userId)
    ) {
      return;
    }
    const found = companiesInOutcome(outcome);
    const tool = outcome.toolName ?? "";
    if (DOCUMENT_READS.has(tool)) {
      const data = outcome.result.data;
      const title = argument(data, "title");
      if (argument(data, "status") !== "READ" || typeof title !== "string") {
        return;
      }
      // Whose document: the company the tool was asked for by id, or the
      // run's one company subject when it named none (as the tool itself
      // resolves it). A name argument is a guess and is not used.
      const asked = argument(proposal.arguments, "companyId");
      const named = argument(proposal.arguments, "company");
      const subjects = context.plan.subjects.filter(
        (subject) => subject.kind === "COMPANY",
      );
      const only =
        subjects.length === 1 && subjects[0]?.kind === "COMPANY"
          ? subjects[0].companyId
          : null;
      const companyId =
        typeof asked === "string" && UUID.test(asked)
          ? asked.toLowerCase()
          : asked === undefined && named === undefined && only !== null
            ? only.toLowerCase()
            : null;
      if (companyId === null) return;
      entryFor(context.runId, context.actor).things.set(
        companyId,
        DECK.test(title) ? "deck" : "document",
      );
      return;
    }
    if (found.length === 0) return;
    const run = entryFor(context.runId, context.actor);
    for (const { companyId, name } of found.slice(0, 50)) {
      if (!run.companies.has(companyId)) run.companies.set(companyId, name);
    }
    if (tool === GET_COMPANY && found.length === 1 && found[0] !== undefined) {
      run.profiled = found[0].companyId;
    }
  };

  const focusFor: RunSubjects["focusFor"] = (runId, actor) => {
    const run = runs.get(runId);
    if (
      run === undefined ||
      run.tenantId !== actor.tenantId ||
      run.userId !== actor.userId
    ) {
      return null;
    }
    // The company the run read the profile of; else the only one it met.
    // Several, none profiled: no name (a list is not a subject).
    const companyId =
      run.profiled ??
      (run.companies.size === 1
        ? (run.companies.keys().next().value ?? null)
        : null);
    if (companyId === null) return null;
    const name = run.companies.get(companyId)?.trim().slice(0, 80);
    if (name === undefined || name.length === 0) return null;
    const thing = run.things.get(companyId);
    return thing === undefined ? { name } : { name, thing };
  };

  return {
    note,
    focusFor,
    observe: (port) => ({
      ...port,
      execute: async (proposal, context) => {
        const outcome = await port.execute(proposal, context);
        try {
          note(proposal, context, outcome);
        } catch {
          // Noting is a nicety for the wait's wording; never the call's.
        }
        return outcome;
      },
    }),
  };
}
