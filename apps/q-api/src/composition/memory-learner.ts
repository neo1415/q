import {
  QConversationIdSchema,
  QRunIdSchema,
  UtcTimestampSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  isModelGatewayError,
  type ModelGateway,
} from "@capital-q/model-gateway";
import type { QMemoryRecall } from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  MemoryExtractorResultSchema,
  renderPrompt,
  type MemoryExtractItem,
  type MemoryExtractorResult,
  type MemoryExtractorVariables,
  type PromptRegistry,
} from "@capital-q/q-core";
import {
  renderMemoryBundle,
  type MemoryCandidate,
  type MemoryConversationDigestPort,
  type MemoryService,
} from "@capital-q/q-knowledge";
import type {
  QConversationMessage,
  QOrchestrator,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

/**
 * Q learning from a conversation (doc 14 §55-§61; ADR 0012).
 *
 * After a run ends, and never inside it: the run's turns, what is already
 * remembered and the conversation's summary so far go to the memory
 * extractor; what comes back goes to the memory write gate, which
 * verifies every quote against the person's recorded turns before a row
 * exists. The conversation's title and rolling summary are written to
 * the runtime. All of it is detached from the answer: a person never
 * waits on Q learning, and a failure here costs a memory, not a turn.
 *
 * This file is also where recall is composed for the prompts: the same
 * service, rendered to bounded text, with this conversation's summary and
 * the person's other recent conversations included, so a new chat knows
 * what the last one was about.
 */

export type MemoryLearnerDependencies = {
  readonly gateway: ModelGateway;
  readonly memory: MemoryService;
  readonly repositories: Pick<
    QRuntimeRepositories,
    "conversations" | "messages" | "runs"
  >;
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  /** What Capital Q calls the person, for the extractor's context. */
  readonly people: {
    readonly displayNameFor: (actor: ActorContext) => Promise<string | null>;
  };
  readonly registry?: PromptRegistry | undefined;
  readonly logger: Logger;
};

export type MemoryLearner = {
  /** Learn from a run that has ended. Detached; never throws. */
  readonly learn: (input: {
    readonly actor: ActorContext;
    readonly runId: string;
  }) => Promise<void>;
  /** The prompt-side recall port. */
  readonly recall: QMemoryRecall;
  /** The Deepgram keyterms this person's memory implies: names they taught Q to hear. */
  readonly termsFor: (actor: ActorContext) => Promise<readonly string[]>;
};

const EXTRACTION_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 1_500,
  attemptTimeoutMs: 30_000,
} as const;

/** How much of a conversation the extractor reads: recent turns, with the summary carrying the rest. */
const TRANSCRIPT_TURNS = 24;
const TURN_MAX_CHARS = 4_000;

function candidateOf(
  item: MemoryExtractItem,
  companyId: string | undefined,
): MemoryCandidate {
  switch (item.type) {
    case "PREFERENCE":
      return {
        memoryType: "preference",
        memoryKey: item.key,
        content: item.content,
        quote: item.quote,
        subject: null,
        structuredValue: {},
      };
    case "PRONUNCIATION":
      return {
        memoryType: "pronunciation",
        memoryKey: item.key,
        content: item.content,
        quote: item.quote,
        subject: null,
        structuredValue: {},
      };
    case "CORRECTION":
      return {
        memoryType: "correction",
        memoryKey: item.key,
        content: item.content,
        quote: item.quote,
        subject: null,
        structuredValue: {},
      };
    case "FACT_ABOUT_PERSON":
      return {
        memoryType: "fact",
        memoryKey: item.key,
        content: item.content,
        quote: item.quote,
        subject: null,
        structuredValue: {},
      };
    case "FACT_ABOUT_COMPANY":
      return {
        memoryType: "fact",
        memoryKey: item.key,
        content: item.content,
        quote: item.quote,
        subject:
          companyId === undefined
            ? null
            : { subjectType: "COMPANY", subjectId: companyId },
        structuredValue: {},
      };
  }
}

export function createConversationDigestPort(
  repositories: Pick<QRuntimeRepositories, "conversations">,
  sql: DatabaseExecutor,
): MemoryConversationDigestPort {
  return {
    digestOf: async (actor, conversationId) => {
      const parsed = QConversationIdSchema.safeParse(conversationId);
      if (!parsed.success) return null;
      const conversation = await repositories.conversations.findForOwner(
        sql,
        actor.tenantId,
        actor.userId,
        parsed.data,
      );
      return conversation === null
        ? null
        : { title: conversation.title, summary: conversation.summary };
    },
    recentDigests: async (actor, except, limit) => {
      const recent = await repositories.conversations.listForOwner(
        sql,
        actor.tenantId,
        actor.userId,
        { limit: limit + 1 },
      );
      return recent
        .filter((c) => c.id !== except && c.summary !== null)
        .slice(0, limit)
        .map((c) => ({
          conversationId: c.id,
          title: c.title,
          summary: c.summary ?? "",
          lastMessageAt: c.lastMessageAt ?? c.createdAt,
        }));
    },
  };
}

export function createMemoryLearner(
  dependencies: MemoryLearnerDependencies,
): MemoryLearner {
  const { gateway, memory, repositories, sql, transactions, logger } =
    dependencies;
  const registry = dependencies.registry ?? createDefaultPromptRegistry();

  const recall: QMemoryRecall = {
    recall: async (input) => {
      const companyIds = input.subjects.flatMap((s: QSubjectRef) =>
        s.kind === "COMPANY" ? [s.companyId] : [],
      );
      const bundle = await memory.recall({
        actor: input.actor,
        conversationId: input.conversationId,
        companyIds,
      });
      return renderMemoryBundle(bundle);
    },
  };

  async function extract(
    actor: ActorContext,
    variables: Omit<
      MemoryExtractorVariables,
      | "operatingMode"
      | "communicationProfile"
      | "communicationGuidance"
      | "environmentNotes"
    >,
    runId: string,
  ): Promise<MemoryExtractorResult | null> {
    const rendered = renderPrompt<MemoryExtractorVariables>(registry, {
      task: "MEMORY_EXTRACTOR",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "You propose; Capital Q verifies every quote against the recorded turns and keeps only what it can verify.",
      variables,
    });
    try {
      const response = await gateway.execute<MemoryExtractorResult>(
        {
          taskClass: "STRUCTURED_EXTRACTION",
          sensitivity: "CONFIDENTIAL",
          budget: EXTRACTION_BUDGET,
          messages: [...rendered.messages],
          output: rendered.output,
          attribution: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            qRunId: runId,
            correlationId: `cor_${runId}`,
          },
        },
        { schema: MemoryExtractorResultSchema },
      );
      if (response.output.kind !== "STRUCTURED") return null;
      const parsed = MemoryExtractorResultSchema.safeParse(
        (response.output as { readonly value: unknown }).value,
      );
      return parsed.success ? parsed.data : null;
    } catch (error: unknown) {
      if (isModelGatewayError(error) && error.failureClass === "CANCELLED") {
        return null;
      }
      logger.warn({ err: error, qRunId: runId }, "memory extraction failed");
      return null;
    }
  }

  return {
    recall,
    termsFor: async (actor) => {
      try {
        const bundle = await memory.recall({ actor, limit: 60 });
        const terms = new Set<string>();
        for (const item of bundle.person) {
          if (item.memoryType !== "pronunciation") continue;
          // pronunciation.nem_salvage → "nem salvage": the key's last
          // segment is the name as the extractor spelled it.
          const tail = item.memoryKey.split(".").at(-1) ?? "";
          const term = tail.replace(/[_-]+/g, " ").trim();
          if (term.length >= 2) terms.add(term.slice(0, 60));
        }
        return [...terms].slice(0, 20);
      } catch {
        return [];
      }
    },
    learn: async ({ actor, runId }) => {
      try {
        const parsedRun = QRunIdSchema.safeParse(runId);
        if (!parsedRun.success) return;
        const run = await repositories.runs.findForActor(
          sql,
          actor.tenantId,
          actor.userId,
          parsedRun.data,
        );
        if (run === null || run.conversationId === null) return;
        const conversation = await repositories.conversations.findForOwner(
          sql,
          actor.tenantId,
          actor.userId,
          run.conversationId,
        );
        if (conversation === null) return;
        const recent: readonly QConversationMessage[] =
          await repositories.messages.listRecentForConversation(
            sql,
            actor.tenantId,
            conversation.id,
            TRANSCRIPT_TURNS,
          );
        // Only turns the summary does not already cover, plus the run's
        // own; the summary carries the rest.
        const through = conversation.summaryThrough;
        const unseen = recent.filter(
          (m) =>
            through === null ||
            m.runId === run.id ||
            Date.parse(m.createdAt) > Date.parse(through),
        );
        const userTurns = unseen
          .filter((m) => m.role === "USER")
          .map((m) => m.content);
        if (userTurns.length === 0) return;
        const companyId = run.subjects.find(
          (s): s is Extract<QSubjectRef, { kind: "COMPANY" }> =>
            s.kind === "COMPANY",
        )?.companyId;
        const known = await memory.recall({
          actor,
          conversationId: conversation.id,
          companyIds: companyId === undefined ? [] : [companyId],
        });
        const result = await extract(
          actor,
          {
            personName: await dependencies.people.displayNameFor(actor),
            transcript: unseen.map((m) => ({
              role: m.role,
              text: m.content.slice(0, TURN_MAX_CHARS),
            })),
            knownMemory: renderMemoryBundle(
              { ...known, thisConversation: null, otherConversations: [] },
              5_000,
            ),
            previousSummary: conversation.summary ?? "",
          },
          run.id,
        );
        if (result === null) return;
        const counts = { remembered: 0, refused: 0, unchanged: 0 };
        for (const item of result.items) {
          const outcome = await memory.remember({
            actor,
            candidate: candidateOf(item, companyId),
            writeMode: "Q_PROPOSED",
            userTurns,
            source: { conversationId: conversation.id, runId: run.id },
          });
          if (outcome.outcome === "REMEMBERED") counts.remembered += 1;
          else if (outcome.outcome === "UNCHANGED") counts.unchanged += 1;
          else counts.refused += 1;
        }
        const last = unseen.at(-1);
        await transactions.run(async (tx) => {
          await repositories.conversations.setDigest(
            tx,
            actor.tenantId,
            conversation.id,
            {
              title: conversation.title ?? result.title,
              summary: result.summary.slice(0, 4_000),
              summaryThrough: UtcTimestampSchema.parse(
                last?.createdAt ?? new Date().toISOString(),
              ),
            },
          );
        });
        logger.info(
          { qRunId: run.id, qConversationId: conversation.id, ...counts },
          "q learned from the conversation",
        );
      } catch (error: unknown) {
        logger.warn(
          { err: error, qRunId: runId },
          "q did not learn from this run",
        );
      }
    },
  };
}

/**
 * The orchestrator, with learning after every run that ends. `start` and
 * `resume` resolve when the engine returns; what follows is detached and
 * never delays or fails the handle the caller receives.
 */
export function withLearning(
  orchestrator: QOrchestrator,
  learner: Pick<MemoryLearner, "learn">,
): QOrchestrator {
  const after = <T extends { readonly runId: string }>(
    input: { readonly actor: ActorContext; readonly runId: string },
    handle: Promise<T>,
  ): Promise<T> =>
    handle.then((result) => {
      void learner.learn({ actor: input.actor, runId: input.runId });
      return result;
    });
  return {
    start: (input) => after(input, orchestrator.start(input)),
    resume: (input) => after(input, orchestrator.resume(input)),
    cancel: (input) => orchestrator.cancel(input),
  };
}
