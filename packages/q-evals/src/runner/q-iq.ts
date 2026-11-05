import { randomUUID } from "node:crypto";

import type { ModelMessage } from "@capital-q/contracts";
import type { ModelProvider } from "@capital-q/model-gateway";

import {
  Q_IQ_WORLD,
  type QIqCase,
  type QIqFact,
} from "../datasets/q-iq/index.js";
import {
  gradeQIqCase,
  Q_IQ_HELPFULNESS_RUBRIC,
  summariseQIq,
  type QIqCaseGrade,
  type QIqSummary,
} from "../graders/q-iq.js";

/**
 * The Q-IQ runner. A subject is anything that can hold a conversation:
 * the real Q runtime (q-iq-world.ts), the bare model given the same
 * authorised facts and the raw conversation, or a scripted model in CI.
 * The runner feeds each case turn by turn, grades every reply with the
 * deterministic graders, and totals cost and latency. A budget stops a
 * live run before it overspends; cases not run are reported as not run.
 */

export type QIqReply = {
  readonly text: string;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type QIqConversation = {
  readonly say: (text: string) => Promise<QIqReply>;
};

export type QIqSubject = {
  readonly name: string;
  readonly open: (evalCase: QIqCase) => Promise<QIqConversation>;
};

/** Rates one finished transcript 1..5 for helpfulness only (live, optional). */
export type QIqHelpfulnessJudge = (
  transcript: readonly { readonly user: string; readonly reply: string }[],
) => Promise<{ readonly score: number | null; readonly costUsd: number }>;

export type QIqCaseRun = {
  readonly caseId: string;
  readonly replies: readonly string[];
  readonly latenciesMs: readonly number[];
  readonly costUsd: number;
  readonly grade: QIqCaseGrade;
  readonly helpfulness: number | null;
  readonly error: string | null;
};

export type QIqRunResult = {
  readonly subject: string;
  readonly casesPlanned: number;
  readonly casesRun: number;
  readonly stoppedForBudget: boolean;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyP50Ms: number | null;
  readonly latencyP95Ms: number | null;
  readonly helpfulnessMean: number | null;
  readonly summary: QIqSummary;
  readonly cases: readonly QIqCaseRun[];
};

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[at] ?? null;
}

export async function runQIq(
  subject: QIqSubject,
  cases: readonly QIqCase[],
  options: {
    readonly budgetUsd?: number | undefined;
    readonly judge?: QIqHelpfulnessJudge | undefined;
    readonly onCase?: ((run: QIqCaseRun, spentUsd: number) => void) | undefined;
  } = {},
): Promise<QIqRunResult> {
  const runs: QIqCaseRun[] = [];
  let spent = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stoppedForBudget = false;
  for (const evalCase of cases) {
    if (options.budgetUsd !== undefined && spent >= options.budgetUsd) {
      stoppedForBudget = true;
      break;
    }
    const replies: string[] = [];
    const latencies: number[] = [];
    let cost = 0;
    let error: string | null = null;
    try {
      const conversation = await subject.open(evalCase);
      for (const turn of evalCase.turns) {
        const reply = await conversation.say(turn.user);
        replies.push(reply.text);
        latencies.push(reply.latencyMs);
        cost += reply.costUsd;
        inputTokens += reply.inputTokens;
        outputTokens += reply.outputTokens;
      }
    } catch (caught: unknown) {
      // A failed turn is graded as an empty reply (it fails); the error is kept.
      error =
        caught instanceof Error
          ? caught.message.slice(0, 300)
          : "unknown error";
    }
    let helpfulness: number | null = null;
    if (options.judge !== undefined && error === null) {
      const judged = await options
        .judge(
          evalCase.turns.map((t, i) => ({
            user: t.user,
            reply: replies[i] ?? "",
          })),
        )
        .catch(() => ({ score: null, costUsd: 0 }));
      helpfulness = judged.score;
      cost += judged.costUsd;
    }
    spent += cost;
    const run: QIqCaseRun = {
      caseId: evalCase.id,
      replies,
      latenciesMs: latencies,
      costUsd: cost,
      grade: gradeQIqCase(Q_IQ_WORLD, evalCase, replies),
      helpfulness,
      error,
    };
    runs.push(run);
    options.onCase?.(run, spent);
  }
  const ran = new Set(runs.map((r) => r.caseId));
  const helpful = runs
    .map((r) => r.helpfulness)
    .filter((h): h is number => h !== null);
  const latencies = runs.flatMap((r) => r.latenciesMs);
  return {
    subject: subject.name,
    casesPlanned: cases.length,
    casesRun: runs.length,
    stoppedForBudget,
    costUsd: spent,
    inputTokens,
    outputTokens,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    helpfulnessMean:
      helpful.length === 0
        ? null
        : helpful.reduce((a, b) => a + b, 0) / helpful.length,
    summary: summariseQIq(
      cases.filter((c) => ran.has(c.id)),
      runs.map((r) => r.grade),
    ),
    cases: runs,
  };
}

/** CI: replies come from the case itself (or a function of it); no model, no cost. */
export function scriptedQIqSubject(
  reply: (evalCase: QIqCase, turn: number) => string = (c, i) =>
    c.turns[i]?.reference ?? "",
  name = "scripted",
): QIqSubject {
  return {
    name,
    open: (evalCase) => {
      let turn = 0;
      return Promise.resolve({
        say: () => {
          const text = reply(evalCase, turn);
          turn += 1;
          return Promise.resolve({
            text,
            latencyMs: 0,
            costUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
          });
        },
      });
    },
  };
}

export type QIqPrice = {
  readonly inputPerMillion: number;
  readonly cachedInputPerMillion: number;
  readonly outputPerMillion: number;
};

export function priceOf(
  usage:
    | { inputTokens: number; cachedInputTokens: number; outputTokens: number }
    | undefined,
  price: QIqPrice,
): number {
  if (usage === undefined) return 0;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (
    (uncached * price.inputPerMillion +
      usage.cachedInputTokens * price.cachedInputPerMillion +
      usage.outputTokens * price.outputPerMillion) /
    1e6
  );
}

/** The facts as the bare model reads them: the same statements Q is given. */
export function renderFacts(facts: readonly QIqFact[]): string {
  return facts
    .map(
      (f, i) =>
        `F${i + 1}. ${f.statement} (source: ${f.source}; ${f.truthClass}, ${f.evidenceStatus})`,
    )
    .join("\n");
}

export const Q_IQ_TODAY = "2026-11-05";

/**
 * The bare model: same provider and model as Q, a minimal neutral system
 * line, the authorised facts, earlier conversations as stored turns, and
 * the raw conversation. No Q machinery of any kind.
 */
export function bareModelQIqSubject(options: {
  readonly provider: ModelProvider;
  readonly modelCode: string;
  readonly price: QIqPrice;
  readonly facts?: readonly QIqFact[] | undefined;
  readonly maxOutputTokens?: number | undefined;
}): QIqSubject {
  const facts = options.facts ?? Q_IQ_WORLD.facts;
  return {
    name: `bare:${options.provider.code}/${options.modelCode}`,
    open: (evalCase) => {
      const earlier = evalCase.priorConversations
        .map(
          (c) =>
            `[${c.when}]\n${c.turns.map((t) => `User: ${t.user}\nAssistant: ${t.q}`).join("\n")}`,
        )
        .join("\n\n");
      const system = [
        `You are an assistant for an ${evalCase.actor === "FOUNDER" ? "founder" : "investor"} on an investment platform. Today is ${Q_IQ_TODAY}.`,
        "Answer using only the facts below and the conversation.",
        "",
        "Facts:",
        renderFacts(facts),
        ...(earlier.length === 0
          ? []
          : ["", "Earlier conversations with this person:", earlier]),
      ].join("\n");
      const history: ModelMessage[] = [{ role: "SYSTEM", content: system }];
      return Promise.resolve({
        say: async (text: string) => {
          history.push({ role: "USER", content: text });
          const started = Date.now();
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60_000);
          try {
            const result = await options.provider.generate(
              {
                modelCode: options.modelCode,
                messages: history,
                output: { kind: "TEXT" },
                tools: [],
                maxOutputTokens: options.maxOutputTokens ?? 800,
                temperature: undefined,
                reasoning: "NONE",
              },
              {
                signal: controller.signal,
                attemptTimeoutMs: 60_000,
                attempt: 1,
                correlationId: `q-iq-${randomUUID()}`,
              },
            );
            const reply =
              result.text.trim().length === 0 ? "(no reply)" : result.text;
            history.push({ role: "ASSISTANT", content: reply });
            return {
              text: reply,
              latencyMs: Date.now() - started,
              costUsd: priceOf(result.usage, options.price),
              inputTokens: result.usage?.inputTokens ?? 0,
              outputTokens: result.usage?.outputTokens ?? 0,
            };
          } finally {
            clearTimeout(timer);
          }
        },
      });
    },
  };
}

/** The helpfulness rubric judge over the same provider; reported apart from the score. */
export function providerHelpfulnessJudge(options: {
  readonly provider: ModelProvider;
  readonly modelCode: string;
  readonly price: QIqPrice;
}): QIqHelpfulnessJudge {
  return async (transcript) => {
    const body = transcript
      .map((t) => `User: ${t.user}\nAssistant: ${t.reply.slice(0, 1500)}`)
      .join("\n\n");
    const result = await options.provider.generate(
      {
        modelCode: options.modelCode,
        messages: [
          { role: "SYSTEM", content: Q_IQ_HELPFULNESS_RUBRIC },
          { role: "USER", content: body },
        ],
        output: { kind: "TEXT" },
        tools: [],
        maxOutputTokens: 40,
        temperature: undefined,
        reasoning: "NONE",
      },
      {
        signal: AbortSignal.timeout(30_000),
        attemptTimeoutMs: 30_000,
        attempt: 1,
        correlationId: `q-iq-judge-${randomUUID()}`,
      },
    );
    const match = /"score"\s*:\s*([1-5])/.exec(result.text);
    return {
      score: match?.[1] === undefined ? null : Number(match[1]),
      costUsd: priceOf(result.usage, options.price),
    };
  };
}
