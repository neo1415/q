import { randomUUID } from "node:crypto";

import type { ChatService } from "@capital-q/communication";
import type { ModelDataPosture } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  InstructionThreadFactsV2Schema,
  renderPrompt,
  type InstructionThreadFacts,
  type InstructionThreadFactsV2,
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
  readonly facts: InstructionThreadFactsV2 | null;
  readonly costUsd: number;
  /**
   * QA run 8a1d57b9: their open question, verbatim, for CODE only -- quoted
   * to the person in a NEEDS_YOU notice when Q may not answer it. Never
   * given to the planner (it reads the typed facts alone).
   */
  readonly question?:
    { readonly messageId: string; readonly text: string } | undefined;
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
  const cache = new Map<
    string,
    { facts: InstructionThreadFactsV2; question: ThreadRead["question"] }
  >();

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
    if (cached !== undefined) {
      return {
        facts: cached.facts,
        costUsd: 0,
        ...(cached.question === undefined ? {} : { question: cached.question }),
      };
    }
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
        await dependencies.gateway.execute<InstructionThreadFactsV2>(
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
          { schema: InstructionThreadFactsV2Schema },
        );
      const costUsd = response.cost.amount;
      if (response.output.kind !== "STRUCTURED")
        return { facts: null, costUsd };
      const parsed = InstructionThreadFactsV2Schema.safeParse(
        response.output.value,
      );
      if (!parsed.success) return { facts: null, costUsd };
      // Topic numbers outside the approved list are dropped, not trusted.
      const facts: InstructionThreadFactsV2 = {
        ...parsed.data,
        topicNumbers: parsed.data.topicNumbers.filter(
          (number) => number <= input.topics.length,
        ),
      };
      // Their latest words, for code to quote to the person; read from the
      // thread itself, never from the model.
      const theirs =
        facts.asksQuestion && latest.from === "OTHER_SIDE"
          ? (latest.text ?? null)
          : null;
      const question =
        theirs === null || theirs.trim() === ""
          ? undefined
          : { messageId: latest.id, text: theirs.trim().slice(0, 400) };
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(key, { facts, question });
      return {
        facts,
        costUsd,
        ...(question === undefined ? {} : { question }),
      };
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, instructionId: input.instructionId },
        "instruction thread not read",
      );
      return { facts: null, costUsd: 0 };
    }
  };
}

const QUESTION_WORDS: Readonly<Record<string, string>> = {
  CHEQUE_SIZE: "cheque size",
  LEAD_OR_FOLLOW: "whether you lead",
  SECTORS: "sectors",
  STAGES: "stages",
  GEOGRAPHIES: "geographies",
  OTHER: "something else",
};

/** The facts as the planner sees them: fixed words, never theirs. */
export function factsLine(
  facts: InstructionThreadFacts & {
    readonly questionAbout?: readonly string[] | undefined;
  },
  topics: readonly string[],
): string {
  const parts: string[] = [`last from ${facts.lastFrom}`];
  if (facts.asksQuestion) {
    const about = (facts.questionAbout ?? [])
      .map((kind) => QUESTION_WORDS[kind])
      .filter((words): words is string => words !== undefined);
    parts.push(
      about.length === 0
        ? "asks a question"
        : `asks a question about ${about.join(", ")}`,
    );
  }
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
