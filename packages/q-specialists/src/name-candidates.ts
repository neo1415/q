import type { Logger } from "@capital-q/observability";
import type {
  QAnswerRequest,
  QConversationState,
  QLedgerEntity,
  QToolPort,
} from "@capital-q/q-runtime";

import { namesIn } from "./conversation-ledger.js";
import { plausibleName } from "./plausible-name.js";
import {
  bindReferences,
  type ReaderReference,
  type ReferenceBinding,
} from "./reference-binding.js";

/**
 * Live Q-IQ 2026-11-06 (AMB-136): "What's Silo's runway?" was answered
 * with Silo Credit, where the person may read both Silo Credit and Silo
 * Health. A name the reader heard (its `namedOther`, or a pointing phrase
 * no ledger entry fits) that fits two companies in the person's own
 * authorised record is one short question naming both, never a guess.
 *
 * Who the candidates are is decided by the record, never by their words:
 * the name is looked up through search_companies' own authorize step
 * (what this person may see), and a company is a candidate only when its
 * recorded name holds the heard name as whole words. The candidates join
 * this turn's view of the conversation's ledger, exactly as records a
 * tool returned do (`withFetchedRecords`; never saved), and the binding
 * then sees one phrase with two readings and asks (reference-binding.ts).
 * Nothing is bound and nothing is granted: the question names what the
 * person may already see.
 *
 * Not ambiguous, and so not asked: a record named exactly that; one
 * candidate only; or one of them already in this conversation's ledger
 * (the conversation decides, as a person following it would).
 */

export type NameCandidate = {
  readonly companyId: string;
  readonly name: string;
};

export type QNameCandidatesPort = (
  request: QAnswerRequest,
  name: string,
) => Promise<readonly NameCandidate[]>;

const SEARCH_LIMIT = 8;

/** search_companies under this run's plan and the tool's own authorize step. */
export function createToolNameCandidatesPort(dependencies: {
  readonly tools: QToolPort;
  readonly logger?: Logger | undefined;
}): QNameCandidatesPort {
  return async (request, name) => {
    try {
      const outcome = await dependencies.tools.execute(
        {
          callId: "q-name-candidates",
          name: "search_companies",
          arguments: { query: name, limit: SEARCH_LIMIT },
        },
        {
          actor: request.actor,
          runId: request.runId,
          correlationId: request.correlationId,
          capability: request.capability,
          plan: request.plan,
          focus: { areas: [], tools: ["search_companies"] },
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
      if (!outcome.result.ok) return [];
      const data: unknown = outcome.result.data;
      const items: unknown =
        typeof data === "object" && data !== null
          ? (data as { readonly items?: unknown }).items
          : undefined;
      if (!Array.isArray(items)) return [];
      return items.flatMap((item: unknown) => {
        if (typeof item !== "object" || item === null) return [];
        const { companyId, canonicalName } = item as Record<string, unknown>;
        return typeof companyId === "string" &&
          typeof canonicalName === "string"
          ? [{ companyId, name: canonicalName }]
          : [];
      });
    } catch (error: unknown) {
      if (request.signal?.aborted === true) throw error;
      dependencies.logger?.warn(
        { err: error, qRunId: request.runId },
        "a heard name's candidates were not read",
      );
      return [];
    }
  };
}

const sameName = (a: string, b: string): boolean =>
  a.replace(/\s+/gu, " ").trim().toLowerCase() ===
  b.replace(/\s+/gu, " ").trim().toLowerCase();

/**
 * The companies a heard name could mean: two or more, or none when the
 * record or the conversation already decides. Pure.
 */
export function nameReadings(
  name: string,
  candidates: readonly NameCandidate[],
  state: QConversationState | null,
): readonly NameCandidate[] {
  if (!plausibleName(name)) return [];
  const fitting: NameCandidate[] = [];
  for (const candidate of candidates) {
    if (!namesIn(candidate.name, name.trim())) continue;
    if (fitting.some((one) => one.companyId === candidate.companyId)) continue;
    fitting.push(candidate);
  }
  if (fitting.length < 2) return [];
  if (fitting.some((candidate) => sameName(candidate.name, name))) return [];
  const known = (state?.ledger.entities ?? []).filter(
    (entity) =>
      entity.kind === "COMPANY" &&
      entity.id !== null &&
      fitting.some((candidate) => candidate.companyId === entity.id),
  );
  if (known.length === 1) return [];
  return fitting;
}

/**
 * This turn's view with the candidates in it (as fetched records are),
 * and the binding of the heard name against it: CLARIFY when it has two
 * readings, null otherwise.
 */
export function bindHeardName(
  phrase: string,
  readings: readonly NameCandidate[],
  state: QConversationState,
): Extract<ReferenceBinding, { kind: "CLARIFY" }> | null {
  if (readings.length < 2) return null;
  const entities: QLedgerEntity[] = [...state.ledger.entities];
  const refs: string[] = [];
  const turn = Math.max(1, state.messagesFolded);
  for (const candidate of readings) {
    const held = entities.find(
      (entity) =>
        entity.kind === "COMPANY" && entity.id === candidate.companyId,
    );
    if (held !== undefined) {
      refs.push(held.ref);
      continue;
    }
    const entity: QLedgerEntity = {
      ref: `E${String(entities.length + 1)}`,
      kind: "COMPANY",
      id: candidate.companyId,
      name: candidate.name,
      firstTurn: turn,
      lastTurn: turn,
      via: ["FETCHED"],
      of: null,
      value: null,
    };
    entities.push(entity);
    refs.push(entity.ref);
  }
  const view: QConversationState = {
    ...state,
    ledger: { ...state.ledger, entities },
  };
  const references: ReaderReference[] = refs.map((ref) => ({
    phrase,
    entityIds: [ref],
    confidence: "MEDIUM",
  }));
  const binding = bindReferences(references, view);
  return binding.kind === "CLARIFY" ? binding : null;
}
