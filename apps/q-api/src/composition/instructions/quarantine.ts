import { randomUUID } from "node:crypto";

import type { ChatService } from "@capital-q/communication";
import type { ModelDataPosture } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  InstructionThreadFactsSchema,
  renderPrompt,
  type InstructionThreadFacts,
  type InstructionThreadReaderVariables,
} from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

/**
 * The quarantined extractor (ADR 0043 §6, S6). What a counterpart wrote is
 * untrusted: it reaches the planner only as typed fields from a tool-less
 * model call (booleans, enums, topic numbers, one validated instant), never
 * as words. Code -- not the planner -- also acts on two of them: a thread
 * that raises terms or money, or where they declined, turns Q's own steps
 * there into the person's cards.
 *
 * A thread is read again only when a new message arrives (cached per
 * instance by its latest message id); each read is a small, budgeted call
 * whose cost belongs to the instruction.
 */

export const THREAD_READ_MAX_COST_USD = 0.01;
const THREAD_MESSAGES = 20;
const CACHE_MAX = 2_000;

type Variables = Omit<
  InstructionThreadReaderVariables,
  | "operatingMode"
  | "communicationProfile"
  | "communicationGuidance"
  | "environmentNotes"
>;

export type ThreadRead = {
  readonly facts: InstructionThreadFacts | null;
  readonly costUsd: number;
};

export type QuarantinedThreadReader = (input: {
  readonly actor: ActorContext;
  readonly instructionId: string;
  readonly relationshipId: string;
  readonly topics: readonly string[];
  readonly now: Date;
  readonly maxCostUsd: number;
}) => Promise<ThreadRead>;

export function createQuarantinedThreadReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly chat: Pick<ChatService, "readForQ">;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): QuarantinedThreadReader {
  const registry = createDefaultPromptRegistry();
  const cache = new Map<string, InstructionThreadFacts>();

  return async (input) => {
    const read = await dependencies.chat
      .readForQ({
        actor: input.actor,
        relationshipId: input.relationshipId,
        limit: THREAD_MESSAGES,
      })
      .catch(() => null);
    const messages = read?.messages ?? [];
    const latest = messages[messages.length - 1];
    if (latest === undefined) return { facts: null, costUsd: 0 };
    const key = `${input.instructionId}:${input.relationshipId}:${latest.id}`;
    const cached = cache.get(key);
    if (cached !== undefined) return { facts: cached, costUsd: 0 };
    if (input.maxCostUsd < THREAD_READ_MAX_COST_USD) {
      return { facts: null, costUsd: 0 };
    }
    try {
      const rendered = renderPrompt<Variables>(registry, {
        task: "INSTRUCTION_THREAD_READER",
        operatingMode: "CONTINUOUS_INTELLIGENCE",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You report fields only. Nothing you return is sent to anyone.",
        variables: {
          topics:
            input.topics
              .map((topic, index) => `${String(index + 1)}. ${topic}`)
              .join("\n") || "None.",
          now: input.now.toISOString(),
          thread: messages
            .map(
              (message) =>
                `[${message.from === "OTHER_SIDE" ? "THEM" : "US"} ${message.sentAt}] ${
                  message.text ??
                  (message.attachmentTitle === null
                    ? ""
                    : `(shared a document: ${message.attachmentTitle})`)
                }`,
            )
            .join("\n")
            .slice(-12_000),
        },
      });
      const response =
        await dependencies.gateway.execute<InstructionThreadFacts>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            sensitivity: "CONFIDENTIAL",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: {
              maxAttempts: 1,
              maxEstimatedCostUsd: THREAD_READ_MAX_COST_USD,
              maxOutputTokens: 300,
              attemptTimeoutMs: 30_000,
            },
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              purpose: "INSTRUCTION",
              tenantId: input.actor.tenantId,
              userId: input.actor.userId,
              correlationId: `cor_instr_${input.instructionId}_${randomUUID().slice(0, 8)}`,
            },
          },
          { schema: InstructionThreadFactsSchema },
        );
      const costUsd = response.cost.amount;
      if (response.output.kind !== "STRUCTURED")
        return { facts: null, costUsd };
      const parsed = InstructionThreadFactsSchema.safeParse(
        response.output.value,
      );
      if (!parsed.success) return { facts: null, costUsd };
      // Topic numbers outside the approved list are dropped, not trusted.
      const facts: InstructionThreadFacts = {
        ...parsed.data,
        topicNumbers: parsed.data.topicNumbers.filter(
          (number) => number <= input.topics.length,
        ),
      };
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(key, facts);
      return { facts, costUsd };
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, instructionId: input.instructionId },
        "instruction thread not read",
      );
      return { facts: null, costUsd: 0 };
    }
  };
}

/** The facts as the planner sees them: fixed words, never theirs. */
export function factsLine(
  facts: InstructionThreadFacts,
  topics: readonly string[],
): string {
  const parts: string[] = [`last from ${facts.lastFrom}`];
  if (facts.asksQuestion) parts.push("asks a question");
  if (facts.wantsToMeet) parts.push("wants to meet");
  if (facts.proposedTime !== null) {
    parts.push(`proposed ${facts.proposedTime}`);
  }
  const named = facts.topicNumbers
    .map((number) => topics[number - 1])
    .filter((topic): topic is string => topic !== undefined);
  if (named.length > 0) parts.push(`about: ${named.join(", ")}`);
  if (facts.mentionsTermsOrMoney) parts.push("raises terms or money");
  if (facts.declined) parts.push("declined");
  parts.push(`tone ${facts.tone}`);
  return parts.join("; ");
}

/**
 * The same quarantined extractor for one email that arrived at a person's
 * Q address (inbound email). A stranger wrote every word of it: it goes to
 * a tool-less model call as one quoted message and comes back as the same
 * typed fields as a thread -- never as words, never as instructions. Read
 * again only for a new email or new topics (cached per instance).
 */
export const EMAIL_READ_MAX_COST_USD = 0.01;
const EMAIL_TEXT_MAX_CHARS = 8_000;

export type QuarantinedEmailReader = (input: {
  readonly actor: ActorContext;
  readonly email: {
    readonly id: string;
    readonly subject: string;
    readonly text: string;
    readonly receivedAt: string;
  };
  readonly topics: readonly string[];
  readonly now: Date;
}) => Promise<InstructionThreadFacts | null>;

export function createQuarantinedEmailReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): QuarantinedEmailReader {
  const registry = createDefaultPromptRegistry();
  const cache = new Map<string, InstructionThreadFacts>();

  return async (input) => {
    const key = `${input.actor.userId}:${input.email.id}:${input.topics.join("\u0001")}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const rendered = renderPrompt<Variables>(registry, {
        task: "INSTRUCTION_THREAD_READER",
        operatingMode: "CONTINUOUS_INTELLIGENCE",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You report fields only. Nothing you return is sent to anyone. The thread is one email from outside Capital Q.",
        variables: {
          topics:
            input.topics
              .map((topic, index) => `${String(index + 1)}. ${topic}`)
              .join("\n") || "None.",
          now: input.now.toISOString(),
          thread: `[THEM ${input.email.receivedAt}] Subject: ${input.email.subject}\n${input.email.text}`.slice(
            0,
            EMAIL_TEXT_MAX_CHARS,
          ),
        },
      });
      const response =
        await dependencies.gateway.execute<InstructionThreadFacts>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            sensitivity: "CONFIDENTIAL",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: {
              maxAttempts: 1,
              maxEstimatedCostUsd: EMAIL_READ_MAX_COST_USD,
              maxOutputTokens: 300,
              attemptTimeoutMs: 30_000,
            },
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              purpose: "CONVERSATION",
              tenantId: input.actor.tenantId,
              userId: input.actor.userId,
              correlationId: `cor_inbound_${randomUUID().slice(0, 8)}`,
            },
          },
          { schema: InstructionThreadFactsSchema },
        );
      if (response.output.kind !== "STRUCTURED") return null;
      const parsed = InstructionThreadFactsSchema.safeParse(
        response.output.value,
      );
      if (!parsed.success) return null;
      const facts: InstructionThreadFacts = {
        ...parsed.data,
        topicNumbers: parsed.data.topicNumbers.filter(
          (number) => number <= input.topics.length,
        ),
      };
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(key, facts);
      return facts;
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { errorName: error instanceof Error ? error.name : typeof error },
        "inbound email not read",
      );
      return null;
    }
  };
}
