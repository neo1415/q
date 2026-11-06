import { randomUUID } from "node:crypto";

import type { ModelProviderSecrets } from "@capital-q/config/model-providers";
import type { ModelProviderCode, QConversationId } from "@capital-q/contracts";
import type { RequestDatabase } from "@capital-q/database";
import type { FakeBehaviour } from "@capital-q/model-gateway";
import {
  createQTurnReader,
  type QTurnReader,
  type QTurnReading,
} from "@capital-q/model-gateway/q";
import { createLogger, type Logger } from "@capital-q/observability";
import type { AuthorisedFact } from "@capital-q/q-core";
import {
  createMemoryRecall,
  createMemoryService,
  createPostgresMemoryRepository,
  type MemoryService,
} from "@capital-q/q-knowledge";
import { createSpecialistQAnswer } from "@capital-q/q-specialists";

import {
  Q_IQ_COMPANIES,
  Q_IQ_FACTS,
  type QIqCase,
  type QIqFact,
} from "../datasets/q-iq/index.js";
import { createQEvalWorld, type QEvalWorld } from "../fixtures/world.js";
import { plantedFacts, type QIqConversation, type QIqSubject } from "./q-iq.js";

/**
 * Q as a Q-IQ subject: each turn is a real run — createRun, the LangGraph
 * orchestrator, the Context Firewall, the Safe Read tools, the outer
 * answer layer with the turn reader (as q-api composes it), the
 * conversational answer layer and the Model Gateway — in one conversation
 * per case, so history comes from stored turns exactly as in production.
 *
 * The authorised facts are the same Q_IQ_FACTS list the bare model reads,
 * released by the fixture context port under the firewall plan's own
 * scope (none when the plan holds none). Scripted (FAKE) mode costs
 * nothing; LIVE mode spends provider credit and is run on request only.
 *
 * Memory recall across conversations IS composed (step 9), as q-api
 * composes it: the memory service over the world's own store, with the
 * person's own past turns searched (full-text, owner-scoped, only when the
 * run's plan admits their own conversations). A case's prior
 * conversations are stored as real conversations of the same person,
 * dated by their `when`, before the case's first turn. Each case starts
 * with only its own history: the earlier cases' conversations of the same
 * fixture person are archived first (harness hygiene; archived
 * conversations are never searched, as in production).
 *
 * Not composed here (production has them): retrieval over documents, the
 * company specialist's own investigation. Q-IQ reports what this
 * composition does; BASELINE.md says so beside the scores.
 */

const ACTORS = { INVESTOR: "INVESTOR", FOUNDER: "FOUNDER" } as const;

const authorised = (f: QIqFact): AuthorisedFact => ({
  scope: "COMPANY",
  statement: f.statement,
  truthClass: f.truthClass,
  evidenceStatus: f.evidenceStatus,
  source: f.source,
  ...(f.asOf === undefined ? {} : { asOf: f.asOf }),
});

/** A name search over the fixture companies (search_companies' stand-in). */
export function qIqNameCandidates(
  name: string,
): readonly { readonly companyId: string; readonly name: string }[] {
  const query = name.trim().toLowerCase();
  if (query.length < 2) return [];
  return Q_IQ_COMPANIES.filter((c) => c.name.toLowerCase().includes(query)).map(
    (c) => ({ companyId: c.id, name: c.name }),
  );
}

export const Q_IQ_AUTHORISED_FACTS: readonly AuthorisedFact[] =
  Q_IQ_FACTS.map(authorised);

const Q_IQ_DESCRIPTION =
  "several fictional companies, people, decks and investors (the authorised facts list them)";

/**
 * A case's authorised context: the shared facts plus what it planted
 * (ADVERSARIAL). A planted company name is also the subject's name, which
 * production writes into the subject description (the company
 * specialist's `canonicalName`): the founder's own words, in the place Q
 * is told what it is looking at.
 */
export function qIqContext(evalCase: QIqCase): {
  readonly facts: readonly AuthorisedFact[];
  readonly description: string;
} {
  const name = evalCase.planted?.find(
    (planted) => planted.carrier === "COMPANY_NAME",
  );
  return {
    facts: [
      ...Q_IQ_AUTHORISED_FACTS,
      ...plantedFacts(evalCase).map(authorised),
    ],
    description:
      name === undefined
        ? Q_IQ_DESCRIPTION
        : `${name.text}, a company available in this conversation, and ${Q_IQ_DESCRIPTION}`.slice(
            0,
            400,
          ),
  };
}

function toolCallsOf(
  calls: readonly {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }[],
): FakeBehaviour {
  return {
    kind: "TOOL_CALLS",
    calls: calls.map((call, index) => ({
      callId: `call_${String(index + 1)}`,
      name: call.name,
      arguments: call.arguments,
    })),
    usage: { inputTokens: 900, cachedInputTokens: 0, outputTokens: 40 },
  };
}

/** How long ago a prior conversation's `when` puts it (fixture words). */
const WHEN_DAYS: Readonly<Record<string, number>> = {
  yesterday: 1,
  "last week": 7,
  "two weeks ago": 14,
  "last month": 30,
};

function analystReply(answer: string): FakeBehaviour {
  return {
    kind: "JSON",
    value: {
      answer,
      responseShape: "CONCISE",
      findings: [],
      missingEvidence: [],
      contradictions: [],
      insufficientEvidence: false,
      recommendation: null,
      clarifyingQuestions: [],
      declined: false,
    },
  };
}

export type QIqWorldSubject = {
  readonly subject: QIqSubject;
  readonly world: () => QEvalWorld;
  readonly close: () => Promise<void>;
};

export async function createQIqWorldSubject(options: {
  readonly db: RequestDatabase;
  readonly providerMode: "FAKE" | "LIVE";
  readonly secrets?: ModelProviderSecrets | undefined;
  readonly providerFilter?: ModelProviderCode | undefined;
  /** The outer layer's turn reader (a model call per turn). Off in FAKE mode. */
  readonly turnReader?: boolean | undefined;
  /**
   * FAKE mode: a scripted turn reader (no model call), so reference
   * binding is exercised offline -- the live reader is a model call, and
   * without one every turn ran on the neutral defaults (live 2026-11-06,
   * QIQ-PRO-001 was invisible here). Given the case, the turn (0-based)
   * and what the reader would be shown; null is "not read".
   */
  readonly scriptedReader?:
    | ((
        evalCase: QIqCase,
        turn: number,
        input: Parameters<QTurnReader["read"]>[0],
      ) => QTurnReading | null)
    | undefined;
  /** Step 9: memory recall across conversations (default on). */
  readonly memory?: boolean | undefined;
  /** FAKE mode: what the scripted model answers for a turn (default: the reference). */
  readonly scriptedReply?:
    ((evalCase: QIqCase, turn: number) => string) | undefined;
  /**
   * FAKE mode, ADVERSARIAL: the scripted model OBEYS the planted text --
   * it says each turn's `compromised` reply and makes its tool calls --
   * so what is measured is what Q's code leaves in effect.
   */
  readonly compromised?: boolean | undefined;
  /** The outer layer's logger (default: errors only), e.g. for timings. */
  readonly logger?: Logger | undefined;
}): Promise<QIqWorldSubject> {
  // Filled once the world exists; the specialist reads it lazily, per run.
  const holder: { world?: QEvalWorld } = {};
  const w = (): QEvalWorld => {
    if (holder.world === undefined) throw new Error("Q-IQ world not created");
    return holder.world;
  };
  const proxy = <T extends object>(pick: () => T): T =>
    new Proxy({} as T, {
      get: (_target, key: string) => (pick() as Record<string, unknown>)[key],
    });
  const logger =
    options.logger ??
    createLogger(
      { serviceName: "q-iq", environment: "local" },
      { level: "error" },
    );
  const turnReader = options.turnReader ?? options.providerMode === "LIVE";
  /** The case and turn being said, for the scripted reader. */
  const saying: { evalCase?: QIqCase; turn: number } = { turn: 0 };
  const scripted = options.scriptedReader;
  const turns: QTurnReader | undefined = turnReader
    ? createQTurnReader({
        gateway: proxy(() => w().gateway),
        logger,
        // Every Q-IQ word is invented fixture text.
        sensitivity: "PUBLIC",
      })
    : scripted === undefined
      ? undefined
      : {
          read: (input) =>
            Promise.resolve(
              saying.evalCase === undefined
                ? null
                : scripted(saying.evalCase, saying.turn, input),
            ),
        };

  // Step 9: the memory service over the world's own store, its past-turn
  // search through the runtime's owner-scoped repository method.
  let memoryService: MemoryService | null = null;
  const memoryOf = (): MemoryService => {
    if (memoryService !== null) return memoryService;
    const search = w().repositories.messages.searchForOwner;
    memoryService = createMemoryService({
      sql: options.db.sql,
      transactions: options.db.transactions,
      repository: createPostgresMemoryRepository(),
      conversations: {
        digestOf: () => Promise.resolve(null),
        recentDigests: () => Promise.resolve([]),
        ...(search === undefined
          ? {}
          : {
              pastTurns: async (actor, query) =>
                (
                  await search(
                    options.db.sql,
                    actor.tenantId,
                    actor.userId,
                    query,
                  )
                ).map((turn) => ({
                  conversationId: turn.conversationId,
                  conversationTitle: turn.conversationTitle,
                  role: turn.role,
                  content: turn.content,
                  at: turn.createdAt,
                })),
            }),
      },
      logger,
    });
    return memoryService;
  };
  const recall =
    options.memory === false
      ? null
      : createMemoryRecall({
          recall: (query) => memoryOf().recall(query),
        });

  holder.world = await createQEvalWorld({
    db: options.db,
    ...(recall === null ? {} : { memory: () => recall }),
    providerMode: options.providerMode,
    secrets: options.secrets,
    providerFilter: options.providerFilter,
    specialist: (delegate) =>
      createSpecialistQAnswer({
        // No company investigation in Q-IQ: every turn is conversational,
        // through the outer layer's reading and reference binding.
        specialist: {
          id: "company-intelligence",
          version: "q-iq-off",
          supports: () => false,
          investigate: () => Promise.reject(new Error("not used in Q-IQ")),
        },
        delegate,
        repositories: proxy(() => w().repositories),
        sql: options.db.sql,
        transactions: options.db.transactions,
        logger,
        ...(turns === undefined ? {} : { turns }),
        // The companies a heard name could mean, as q-api reads them with
        // search_companies: here the fixture companies, every one of them
        // authorised (their facts are all released), matched by name.
        nameCandidates: (_request, name) =>
          Promise.resolve(qIqNameCandidates(name)),
      }),
  });

  const usageTotal = async (): Promise<{
    cost: number;
    input: number;
    output: number;
  }> => {
    const [row] = await options.db.sql<
      { cost: string | null; input: string | null; output: string | null }[]
    >`select sum(cost_usd)::text as cost, sum(input_tokens)::text as input, sum(output_tokens)::text as output from ai_ops.model_usage`;
    return {
      cost: Number(row?.cost ?? 0),
      input: Number(row?.input ?? 0),
      output: Number(row?.output ?? 0),
    };
  };

  /**
   * The case's own history, before its first turn: earlier cases'
   * conversations of this person are archived, then each prior
   * conversation is stored as a real one (a run per person turn, whose
   * stored words are theirs, and Q's reply beside it), dated by its
   * `when`. No model is called: these are what was said, as written.
   */
  async function seedPriorConversations(
    evalCase: QIqCase,
    person: QEvalWorld["people"]["INVESTOR"],
  ): Promise<void> {
    const { tenantId, userId } = person.actor;
    await options.db.sql`
      update q_runtime.conversations
         set archived_at = coalesce(archived_at, now())
       where tenant_id = ${tenantId} and user_id = ${userId}`;
    for (const prior of evalCase.priorConversations) {
      const days = WHEN_DAYS[prior.when.trim().toLowerCase()] ?? 7;
      const at = Date.now() - days * 24 * 60 * 60 * 1000;
      let priorConversation: QConversationId | null = null;
      for (const [index, turn] of prior.turns.entries()) {
        const created: Awaited<ReturnType<QEvalWorld["runtime"]["createRun"]>> =
          await w().runtime.createRun({
            actor: person.actor,
            input: {
              capability: "ANSWER",
              message: { text: turn.user },
              modality: "TEXT",
              subjects: [],
              ...(priorConversation === null
                ? {}
                : { conversationId: priorConversation }),
            },
            idempotencyKey: `q-iq-prior-${randomUUID()}`,
            correlationId: `cor_${randomUUID()}` as never,
          });
        priorConversation = created.conversation.id;
        const userAt = new Date(at + index * 60_000).toISOString();
        const qAt = new Date(at + index * 60_000 + 5_000).toISOString();
        await options.db.sql`
          update q_runtime.conversation_messages
             set created_at = ${userAt}::timestamptz
           where tenant_id = ${tenantId} and run_id = ${created.run.id}`;
        await options.db.sql`
          insert into q_runtime.conversation_messages
            (tenant_id, conversation_id, run_id, role, content, created_at)
          values (${tenantId}, ${created.conversation.id}, ${created.run.id},
                  'Q', ${turn.q}, ${qAt}::timestamptz)`;
        await options.db.sql`
          update q_runtime.conversations
             set last_message_at = ${qAt}::timestamptz
           where tenant_id = ${tenantId} and id = ${created.conversation.id}`;
      }
    }
  }

  const subject: QIqSubject = {
    name:
      options.providerMode === "LIVE"
        ? `q:${options.providerFilter ?? "routed"}`
        : "q:scripted",
    open: (evalCase) => {
      const person = w().people[ACTORS[evalCase.actor]];
      w().setPreset("BALANCED");
      w().setFactList(qIqContext(evalCase));
      w().resetProviderHealth();
      const seeded = seedPriorConversations(evalCase, person);
      let conversationId: QConversationId | null = null;
      let turn = 0;
      const conversation: QIqConversation = {
        say: async (text) => {
          await seeded;
          if (w().providerMode === "FAKE") {
            const obeyed =
              options.compromised === true
                ? evalCase.turns[turn]?.compromised
                : undefined;
            const reply =
              obeyed?.reply ??
              options.scriptedReply?.(evalCase, turn) ??
              evalCase.turns[turn]?.reference ??
              "";
            w().setScript([
              ...(obeyed === undefined || obeyed.toolCalls.length === 0
                ? []
                : [toolCallsOf(obeyed.toolCalls)]),
              analystReply(reply),
            ]);
          }
          const observedBefore = w().answer.lastObservation();
          saying.evalCase = evalCase;
          saying.turn = turn;
          turn += 1;
          const before = await usageTotal();
          const started = Date.now();
          const correlationId = `cor_${randomUUID()}` as never;
          const created = await w().runtime.createRun({
            actor: person.actor,
            input: {
              capability: "ANSWER",
              message: { text },
              modality: "TEXT",
              subjects: [],
              ...(conversationId === null ? {} : { conversationId }),
            },
            idempotencyKey: `q-iq-${randomUUID()}`,
            correlationId,
          });
          await w()
            .orchestrator.start({
              actor: person.actor,
              runId: created.run.id,
              correlationId,
            })
            .catch(() => undefined);
          const latencyMs = Date.now() - started;
          const messages = await w().repositories.messages.listForRun(
            options.db.sql,
            person.actor.tenantId,
            created.run.id,
            16,
          );
          conversationId = messages[0]?.conversationId ?? conversationId;
          const after = await usageTotal();
          const reply = messages
            .filter((m) => m.role === "Q")
            .map((m) => m.content)
            .join(" ")
            .trim();
          // The tools that succeeded in this turn's answer (none when no
          // answer was observed this turn).
          const observed = w().answer.lastObservation();
          const toolsRun =
            observed === undefined || observed === observedBefore
              ? []
              : observed.toolCalls
                  .filter((call) => call.status === "SUCCEEDED")
                  .map((call) => call.providerName);
          return {
            text: reply.length === 0 ? "(no reply)" : reply,
            toolsRun,
            latencyMs,
            costUsd: after.cost - before.cost,
            inputTokens: after.input - before.input,
            outputTokens: after.output - before.output,
          };
        },
      };
      return Promise.resolve(conversation);
    },
  };

  return {
    subject,
    world: w,
    close: async () => {
      w().setFactList(null);
      await w().close();
    },
  };
}
