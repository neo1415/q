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

/**
 * ADR 0050: the pace of a conversation, read by code from the messages'
 * sides and times -- never from a model. The consider step uses it to
 * decide whether now is the moment for a message.
 */
export type ThreadPace = {
  readonly lastFrom: "THEM" | "US" | "NONE";
  /** When the person's side last wrote; null when it never has. */
  readonly lastFromUsAt: Date | null;
  /** The person's side's messages since the other side last wrote. */
  readonly unansweredFromUs: number;
  readonly theyHaveWritten: boolean;
  /** When the other side last wrote (F24: a draft older than it is stale). */
  readonly lastFromThemAt?: Date | null | undefined;
};

export function threadPace(
  messages: readonly {
    readonly from: "YOU" | "YOUR_SIDE" | "OTHER_SIDE";
    readonly sentAt: string;
  }[],
): ThreadPace {
  let lastFromUsAt: Date | null = null;
  let lastFromThemAt: Date | null = null;
  let unansweredFromUs = 0;
  let theyHaveWritten = false;
  for (const message of messages) {
    if (message.from === "OTHER_SIDE") {
      theyHaveWritten = true;
      unansweredFromUs = 0;
      const at = new Date(message.sentAt);
      if (!Number.isNaN(at.getTime())) lastFromThemAt = at;
      continue;
    }
    unansweredFromUs += 1;
    const at = new Date(message.sentAt);
    if (!Number.isNaN(at.getTime())) lastFromUsAt = at;
  }
  const last = messages[messages.length - 1];
  return {
    lastFrom:
      last === undefined ? "NONE" : last.from === "OTHER_SIDE" ? "THEM" : "US",
    lastFromUsAt,
    unansweredFromUs,
    theyHaveWritten,
    lastFromThemAt,
  };
}

/**
 * Seed F25 (Zino, 7 Oct): code's own read of what they last wrote, before
 * and around the model's. Tensorgate's "Raising a $4m seed. Want the deck,
 * or 20 minutes this week?" was read as terms or money; Ledgerline's
 * same-shaped "we are raising a $1.8m seed. Happy to share the deck or
 * find 20 minutes" was not. A company stating its own raise or traction
 * while offering a deck, a document, a call or a meeting is an OFFER, never
 * terms. TERMS is the investor-directed vocabulary (valuation, an
 * allocation or cheque from us, instrument terms, signing): it always keeps
 * the model's own (cautious) reading, so code only ever clears a terms flag
 * where nothing like terms was said.
 */
export type TheirMessageKind = "OFFER" | "TERMS";

const TERMS_WORDS =
  /\b(?:valuations?|pre[- ]money|post[- ]money|term ?sheets?|terms|convertible|cap table|discount|allocations?|tickets?|cheques?|check size|commit(?:s|ted|ment|ments)?|pro[- ]rata|side letter|sign(?:ing|ed)?|price per share|equity|stake|dilution|invest(?:ing|ment)? (?:of )?(?:\$|£|€|USD|GBP|EUR|NGN|₦|\d)|take (?:a |an )?(?:\$|£|€|₦|\d)|put in (?:\$|£|€|₦|\d)|how much (?:would|could|can|will) you)\b/iu;
// Case-sensitive: "SAFE" the instrument, never "safe" the adjective.
const SAFE_NOTE = /\bSAFEs?\b/u;
const OFFERED_THING =
  /\b(?:deck|one[- ]pager|memo|data ?room|methodology|materials?|call|calls|meeting|meet|demo|walkthrough|\d{1,2}\s?(?:-\s?)?min(?:ute)?s?)\b/iu;
const OFFER_VERB =
  /\b(?:share|send|happy to|glad to|would you like|want|keen to|find|hop on|grab|set up|arrange|book|schedule)\b/iu;
const MEETING_OFFER =
  /\b(?:call|calls|meeting|meet|demo|walkthrough|\d{1,2}\s?(?:-\s?)?min(?:ute)?s?)\b/iu;

export function classifyTheirMessage(text: string): TheirMessageKind | null {
  if (TERMS_WORDS.test(text) || SAFE_NOTE.test(text)) return "TERMS";
  if (!OFFERED_THING.test(text) || !OFFER_VERB.test(text)) return null;
  // Every question they ask must itself be the offer ("Want the deck, or 20
  // minutes?"); another question keeps the model's reading.
  const questions = text
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => sentence.includes("?"));
  return questions.every((sentence) => OFFERED_THING.test(sentence))
    ? "OFFER"
    : null;
}

/**
 * The model's facts with code's read applied: an offer is not terms, is no
 * question that needs the person's facts, and a call or meeting offered is
 * wanting to meet; where terms words appear, the model's reading stands. Their latest unanswered
 * messages only.
 */
export function withCodeRead(
  facts: InstructionThreadFactsV2,
  theirLatest: string,
): InstructionThreadFactsV2 {
  const kind = classifyTheirMessage(theirLatest);
  if (kind === "TERMS") return facts;
  if (kind === "OFFER") {
    return {
      ...facts,
      mentionsTermsOrMoney: false,
      asksQuestion: false,
      questionAbout: [],
      wantsToMeet: facts.wantsToMeet || MEETING_OFFER.test(theirLatest),
    };
  }
  return facts;
}

/** Their messages since the person's side last wrote, oldest first. */
function theirUnanswered(
  messages: readonly {
    readonly from: "YOU" | "YOUR_SIDE" | "OTHER_SIDE";
    readonly text: string | null;
  }[],
): string {
  const out: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.from !== "OTHER_SIDE") break;
    if (message.text !== null) out.unshift(message.text);
  }
  return out.join("\n");
}

export type ThreadRead = {
  readonly facts: InstructionThreadFactsV2 | null;
  readonly costUsd: number;
  /** ADR 0050: the conversation's pace, by code; absent when unread. */
  readonly pace?: ThreadPace | undefined;
  /**
   * QA run 8a1d57b9: their open question, verbatim, for CODE only -- quoted
   * to the person in a NEEDS_YOU notice when Q may not answer it. Never
   * given to the planner (it reads the typed facts alone).
   */
  readonly question?:
    { readonly messageId: string; readonly text: string } | undefined;
  /**
   * Zino, 2026-10-08: the conversation as the reviewer reads it, and their
   * latest unanswered words, for CODE's thread-consistency check and the
   * reviewer's untrusted thread slot only. Never given to the planner,
   * which still reads the typed facts alone (S6).
   */
  readonly transcript?: string | undefined;
  readonly theirLatest?: string | undefined;
};

/** The thread in the reviewer's words: sides and times, oldest first. */
export function transcriptOf(
  messages: readonly {
    readonly from: "YOU" | "YOUR_SIDE" | "OTHER_SIDE";
    readonly sentAt: string;
    readonly text: string | null;
    readonly attachmentTitle?: string | null | undefined;
  }[],
): string {
  return messages
    .map(
      (message) =>
        `[${message.from === "OTHER_SIDE" ? "THEM" : "US"} ${message.sentAt}] ${
          message.text ??
          ((message.attachmentTitle ?? null) === null
            ? ""
            : `(shared a document: ${message.attachmentTitle ?? ""})`)
        }`,
    )
    .join("\n")
    .slice(-8_000);
}

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
    // Read only when the thread itself was read: an unread thread has no
    // known pace, and code then falls back to the typed facts.
    const pace = read === null ? undefined : threadPace(messages);
    const theirLatest = theirUnanswered(messages);
    const paced = {
      ...(pace === undefined ? {} : { pace }),
      ...(messages.length === 0 ? {} : { transcript: transcriptOf(messages) }),
      ...(theirLatest === "" ? {} : { theirLatest }),
    };
    const latest = messages[messages.length - 1];
    if (latest === undefined) return { facts: null, costUsd: 0, ...paced };
    const key = `${input.instructionId}:${input.relationshipId}:${latest.id}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return {
        ...paced,
        facts: cached.facts,
        costUsd: 0,
        ...(cached.question === undefined ? {} : { question: cached.question }),
      };
    }
    if (input.maxCostUsd < THREAD_READ_MAX_COST_USD) {
      return { facts: null, costUsd: 0, ...paced };
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
        return { facts: null, costUsd, ...paced };
      const parsed = InstructionThreadFactsV2Schema.safeParse(
        response.output.value,
      );
      if (!parsed.success) return { facts: null, costUsd, ...paced };
      // Topic numbers outside the approved list are dropped, not trusted;
      // code's own read of an offer applies over the model's (F25).
      const facts: InstructionThreadFactsV2 = withCodeRead(
        {
          ...parsed.data,
          topicNumbers: parsed.data.topicNumbers.filter(
            (number) => number <= input.topics.length,
          ),
        },
        theirUnanswered(messages),
      );
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
        ...paced,
        facts,
        costUsd,
        ...(question === undefined ? {} : { question }),
      };
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, instructionId: input.instructionId },
        "instruction thread not read",
      );
      return { facts: null, costUsd: 0, ...paced };
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
}) => Promise<InstructionThreadFactsV2 | null>;

export function createQuarantinedEmailReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): QuarantinedEmailReader {
  const registry = createDefaultPromptRegistry();
  const cache = new Map<string, InstructionThreadFactsV2>();

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
          thread:
            `[THEM ${input.email.receivedAt}] Subject: ${input.email.subject}\n${input.email.text}`.slice(
              0,
              EMAIL_TEXT_MAX_CHARS,
            ),
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
          { schema: InstructionThreadFactsV2Schema },
        );
      if (response.output.kind !== "STRUCTURED") return null;
      const parsed = InstructionThreadFactsV2Schema.safeParse(
        response.output.value,
      );
      if (!parsed.success) return null;
      const facts: InstructionThreadFactsV2 = {
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
