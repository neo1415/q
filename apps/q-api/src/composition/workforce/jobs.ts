import type { Logger } from "@capital-q/observability";
import {
  AGENT_REGISTRY,
  DEFAULT_REVIEW_POLICY,
  RUBRIC_VERSION,
  EMPTY_SITUATION,
  boundPlan,
  executorRosterText,
  groundReasoning,
  groundStepEvidence,
  planIsValid,
  registeredExecutors,
  reviewSignals,
  runJob,
  situationText,
  type JobSituation,
  type AgentExecutor,
  type BoundStep,
  type JobRecorder,
  type PriorRun,
  type StepRefusal,
  type StepResult,
} from "@capital-q/q-orchestrator";
import {
  isWorkforceAnalysisRequest,
  WORKFORCE_DILIGENCE_PROFILE,
  workforceCorrelationId,
  type QAgentRole,
  type WorkforceDocumentRequest,
  type WorkforceJobReasoning,
} from "@capital-q/contracts";
import { stanceDeclines } from "@capital-q/q-core";
import { z } from "zod";

import {
  ResearchDossierSchema,
  type ResearchDossier,
} from "./deep-research.js";

import type {
  WorkforceDiligenceInput,
  WorkforceDiligenceResult,
} from "./diligence.js";
import type { LiveReport } from "./live.js";
import type { WorkforceModels } from "./models.js";
import { heldLine, type OutwardReview } from "./review.js";
import type { Owner, WorkforceStore } from "./store.js";

/**
 * The lead Q (founder brief J1, J4, J9): a job in the person's words is
 * planned into steps owned by agents, bounded by what the person allowed
 * and by the job's budget, then carried out agent by agent.
 *
 * The job's grant is the person's approval of it (an approved standing
 * instruction, delegation or prepared job): `permitted` is what it allows,
 * code's list, never the model's. Each agent works only through the ports
 * below, which are the app's own authorized services. Every message to
 * the other side is written, graded by the reviewer and sent only if it
 * passes; replies are read by meaning (REPLY_READER), never by a phrase
 * list, and a reply that may be a no is the person's to answer.
 */

export type MandateMatch = {
  readonly companyId: string;
  readonly name: string;
};

export type OpenConversation = {
  readonly relationshipId: string;
  readonly counterpartName: string;
  /** "Name: words" per line, oldest first. */
  readonly thread: string;
  /** Their latest message, when it is theirs and unanswered. */
  readonly latest: { readonly id: string; readonly text: string } | null;
  /** What Q may state as fact for the person in this conversation. */
  readonly material: string;
};

export type WorkforceDocumentInput = {
  readonly canContinue: () => Promise<boolean>;
  /** Where the work stands, for the person watching (never awaited). */
  readonly progress?: LiveReport | undefined;
  readonly request: WorkforceDocumentRequest;
  readonly goal: string;
  /** Original approved Q run, never the workforce step run. */
  readonly qRunId: string;
  readonly jobId: string;
  readonly stepKey: string;
  readonly runId: string;
  readonly organisationId: string;
  readonly budgetUsd: number;
  /** A critique step: the document the step it reviews prepared. */
  readonly source?:
    { readonly artifactId: string; readonly companyId: string } | undefined;
  /** Whom the work is for, as the critic addresses them. */
  readonly principalName?: string | undefined;
  /** The job in the person's own words (an ANALYSIS is written to it). */
  readonly personRequest?: string | undefined;
  /** ANALYSIS: the research steps it waits on, their admitted facts. */
  readonly research?: readonly ResearchDossier[] | undefined;
  /**
   * The public research it rests on could not be had (2026-10-25): the
   * document is written from Capital Q's own records and states the gap.
   */
  readonly publicSources?: PublicSourcesGap | undefined;
};
export type WorkforceDocumentResult =
  | {
      readonly status: "READY" | "PREPARING";
      readonly artifactId: string;
      /** The company the document is about (bound, never a model's). */
      readonly companyId?: string | undefined;
      /** A critique step's verdict. */
      readonly review?: WorkforceDocumentReview | undefined;
      /** ANALYSIS: what Q says when it lands (conclusion, top three). */
      readonly delivery?: WorkforceDocumentDelivery | undefined;
    }
  | { readonly status: "FAILED" | "UNAVAILABLE"; readonly message: string };

/**
 * Owner 2026-10-23: when deep work finishes, its document lands in the
 * conversation with Q's summary of the conclusion and the top three
 * recommendations (the document's own words, written by its author).
 */
export type WorkforceDocumentDelivery = {
  readonly title: string;
  readonly artifactType: string;
  readonly summary: string;
  readonly topRecommendations: readonly string[];
  /** The second analyst's last verdict passed. */
  readonly passed: boolean;
  /** Reviewer findings still open when it was filed (none when passed). */
  readonly openIssues: number;
};

export type WorkforceDocumentReview = {
  readonly material: boolean;
  readonly issues: readonly {
    readonly kind: string;
    readonly section: string;
    readonly problem: string;
  }[];
  /** The version the reviewer's revision made; null: none was needed. */
  readonly revisedToVersion: number | null;
};
export type DocumentExecutionContext = {
  readonly qRunId: string;
  readonly organisationId: string;
  /** Checks cancellation AND the current worker's lease before each continuation. */
  readonly canContinue: () => Promise<boolean>;
  /** Owner 2026-10-24: keeps where document work stands on the job's row. */
  readonly progress?: LiveReport | undefined;
};

/** The app's own services an agent may call, each authorized for the owner. */
export type WorkforcePorts = {
  /** DILIGENCE: founder questions from a document, filed for approval. */
  readonly diligence?:
    | ((
        owner: Owner,
        input: WorkforceDiligenceInput,
      ) => Promise<WorkforceDiligenceResult>)
    | undefined;
  readonly documents?:
    | ((
        owner: Owner,
        input: WorkforceDocumentInput,
      ) => Promise<WorkforceDocumentResult>)
    | undefined;
  readonly principalName: (owner: Owner) => Promise<string>;
  /** Mandate watcher: companies newly matching the declared mandate. */
  readonly mandateMatches: (owner: Owner) => Promise<readonly MandateMatch[]>;
  readonly expressInterest: (
    owner: Owner,
    companyId: string,
    idempotencyKey: string,
  ) => Promise<{ readonly ok: boolean }>;
  /** Conversation: relationships with a reply waiting. */
  readonly openConversations: (
    owner: Owner,
  ) => Promise<readonly OpenConversation[]>;
  /** The writer's first draft of a reply. Null: nothing honest to say. */
  readonly writeReply: (
    owner: Owner,
    conversation: OpenConversation,
    intent: "WARM_REPLY" | "PROPOSE_TIMES",
    /** J6: the writer's call is priced under the job's own run. */
    correlationId?: string,
    /** D-09: what this reply is for (the step's goal), never empty. */
    brief?: string,
  ) => Promise<string | null>;
  /**
   * Sends as the person, marked as Q's (D-07: `jobId` is the message's
   * Q marker, so the other side sees it was sent by Q). False or a throw:
   * nothing was sent.
   */
  readonly send: (
    owner: Owner,
    relationshipId: string,
    idempotencyKey: string,
    body: string,
    jobId?: string,
  ) => Promise<boolean>;
  /**
   * RESEARCH (D1): bounded public-web research through the composed
   * research service. Absent where no provider is composed, and then the
   * role is not registered at all.
   */
  readonly research?:
    | ((
        owner: Owner,
        input: {
          readonly jobId: string;
          readonly runId: string;
          /** The job in the person's words: their request. */
          readonly request: string;
          /** The step's goal: what must be learned (deep research plans its questions from it). */
          readonly query: string;
          /** What the step may spend (deep research). */
          readonly budgetUsd?: number | undefined;
          /** Where the research stands, for the person watching. */
          readonly progress?: LiveReport | undefined;
          /**
           * Diligence (2026-10-28): the company a later diligence document
           * in this approved plan is about (bound by code, never a model).
           */
          readonly subject?: { readonly companyId: string } | undefined;
        },
      ) => Promise<ResearchFound>)
    | undefined;
  /** Scheduler. */
  readonly freeSlots: (
    owner: Owner,
    relationshipId: string,
  ) => Promise<readonly string[]>;
  readonly book: (
    owner: Owner,
    relationshipId: string,
    idempotencyKey: string,
    startsAt: string,
  ) => Promise<{ readonly ok: boolean; readonly meetingId: string | null }>;
  /** Something the person should see (a possible no, a held draft). */
  readonly notify: (
    owner: Owner,
    notice: {
      readonly key: string;
      readonly title: string;
      readonly body: string;
    },
  ) => Promise<void>;
};

export type ResearchFound =
  | {
      readonly status: "OK";
      /** The query that left Capital Q. */
      readonly query: string;
      readonly sources: readonly {
        readonly url: string;
        readonly title: string | null;
        readonly domain: string;
      }[];
      /** Deep research: admitted, sourced facts for the document after it. */
      readonly dossier?: ResearchDossier | undefined;
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly message: string;
      /**
       * Why (production 2026-10-25): only NOT_ALLOWED stops the job; public
       * sources that could not be reached, or held nothing, leave the work
       * to go on from Capital Q's own records with the gap stated.
       */
      readonly reason?: ResearchGapReason | undefined;
    };

export type ResearchGapReason =
  "PUBLIC_UNAVAILABLE" | "NO_SOURCES" | "NOTHING_TO_RESEARCH" | "NOT_ALLOWED";

/** What a later step reads about the public research it rests on. */
export type PublicSourcesGap = "UNAVAILABLE" | "NONE_FOUND" | "NOT_RUN";

const GAP_OF: Readonly<
  Record<Exclude<ResearchGapReason, "NOT_ALLOWED">, PublicSourcesGap>
> = {
  PUBLIC_UNAVAILABLE: "UNAVAILABLE",
  NO_SOURCES: "NONE_FOUND",
  NOTHING_TO_RESEARCH: "NOT_RUN",
};

const GAP_SUMMARY: Readonly<Record<PublicSourcesGap, string>> = {
  UNAVAILABLE:
    "Public sources couldn't be checked just now, so the work goes on from Capital Q's own records, with that gap stated.",
  NONE_FOUND:
    "The searches found no public sources for this, so the work goes on from Capital Q's own records, with that gap stated.",
  NOT_RUN:
    "There was nothing in the request to look up publicly, so the work goes on from Capital Q's own records.",
};

/** The gravest gap among the steps a step rests on, if any. */
export function publicSourcesGapOf(
  outputs: readonly (Readonly<Record<string, unknown>> | undefined)[],
): PublicSourcesGap | null {
  const gaps = outputs.map((one) => one?.["publicSources"]);
  for (const gap of ["UNAVAILABLE", "NONE_FOUND", "NOT_RUN"] as const) {
    if (gaps.includes(gap)) return gap;
  }
  return null;
}

/** The plain words a document's own line adds for its gap. */
export const DOCUMENT_GAP_LINE: Readonly<Record<PublicSourcesGap, string>> = {
  UNAVAILABLE:
    "Public sources were unavailable, so it rests on Capital Q's own records; the gap is stated in it.",
  NONE_FOUND:
    "No public sources were found, so it rests on Capital Q's own records; the gap is stated in it.",
  NOT_RUN: "It rests on Capital Q's own records.",
};

const MAX_PER_STEP = 25;

function recorderFor(store: WorkforceStore, owner: Owner): JobRecorder {
  return {
    startRun: (input) =>
      store.startRun(owner, {
        jobId: input.jobId,
        role: input.role,
        agentName: input.agentName,
        goal: input.goal,
        tools: input.tools,
        budgetUsd: input.budgetUsd,
        stepKey: input.stepKey,
        spawnedByRunId: input.spawnedByRunId,
      }),
    endRun: (runId, status, summary) =>
      store.endRun(owner, runId, status, summary),
    handoff: (input) =>
      store.handoff(owner, {
        jobId: input.jobId,
        fromRunId: input.fromRunId,
        toRunId: input.toRunId,
        draftId: null,
        note: input.note,
      }),
  };
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The agents, by registered role, over the app's ports. */
export function createWorkforceExecutors(dependencies: {
  readonly owner: Owner;
  readonly ports: WorkforcePorts;
  readonly models: Pick<WorkforceModels, "readReply">;
  readonly review: OutwardReview;
  /** Another agent in this job books calls: a wish to meet is its. */
  readonly scheduling: boolean;
  /** The job in the person's words: research reads it as their request. */
  readonly goal?: string | undefined;
  /**
   * The approved plan's steps: a RESEARCH step a diligence document waits
   * on researches that document's company (2026-10-28).
   */
  readonly steps?: readonly BoundStep[] | undefined;
  readonly documentContext?: DocumentExecutionContext | undefined;
  readonly documentPolling?:
    | {
        readonly now: () => number;
        readonly wait: () => Promise<void>;
        readonly deadlineMs: number;
      }
    | undefined;
}): Partial<Record<QAgentRole, AgentExecutor>> {
  const { owner, ports, models, review } = dependencies;

  const has = (tools: readonly string[], tool: string) => tools.includes(tool);
  // One reading per message per job: the conversation and the scheduler
  // agents act on the same reading, and a reply is classified once.
  const readings = new Map<
    string,
    Promise<Awaited<ReturnType<WorkforceModels["readReply"]>>>
  >();

  const documents: AgentExecutor | null =
    ports.documents === undefined
      ? null
      : async (step, context) => {
          const authority = dependencies.documentContext;
          if (
            !has(step.tools, "documents.own.prepare") ||
            step.document === undefined ||
            authority === undefined ||
            !authority.qRunId ||
            !authority.organisationId
          ) {
            return {
              status: "FAILED",
              summary:
                "The approved document request or its authority is unavailable.",
            };
          }
          // A critique reviews what its source step prepared, nothing else.
          const request = step.document;
          let source: { artifactId: string; companyId: string } | undefined;
          if (request.operation === "CRITIQUE_AND_REVISE") {
            const outputs = context.results.get(request.sourceStep)?.outputs;
            const artifactId = outputs?.["artifactId"];
            const companyId = outputs?.["companyId"];
            if (typeof artifactId !== "string" || typeof companyId !== "string")
              return {
                status: "FAILED",
                summary: "The document to review was not prepared.",
              };
            source = { artifactId, companyId };
          }
          // ANALYSIS: the dossiers of the research steps it waits on, as
          // persisted (re-validated here: the job's stored results are a
          // trust boundary).
          const research = step.dependsOn.flatMap((key) => {
            const parsed = ResearchDossierSchema.safeParse(
              context.results.get(key)?.outputs?.["dossier"],
            );
            return parsed.success ? [parsed.data] : [];
          });
          const publicSources = publicSourcesGapOf(
            step.dependsOn.map((key) => context.results.get(key)?.outputs),
          );
          // The critic, and the analyst writing for them, address the
          // person by name.
          const principalName =
            source === undefined && !isWorkforceAnalysisRequest(request)
              ? undefined
              : await ports.principalName(owner).catch(() => undefined);
          const polling = dependencies.documentPolling ?? {
            now: Date.now,
            wait: () =>
              new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
            deadlineMs: 10 * 60_000,
          };
          const deadline = polling.now() + polling.deadlineMs;
          while (polling.now() < deadline) {
            if (!(await authority.canContinue())) {
              return {
                status: "FAILED",
                summary: "Document work stopped before the next continuation.",
              };
            }
            const result = await ports.documents?.(owner, {
              canContinue: authority.canContinue,
              progress: authority.progress,
              request,
              ...(source === undefined ? {} : { source }),
              ...(principalName === undefined ? {} : { principalName }),
              ...(research.length === 0 ? {} : { research }),
              ...(publicSources === null ? {} : { publicSources }),
              ...(dependencies.goal === undefined
                ? {}
                : { personRequest: dependencies.goal.slice(0, 4_000) }),
              goal: step.goal,
              jobId: context.jobId,
              stepKey: step.key,
              runId: context.runId,
              qRunId: authority.qRunId,
              organisationId: authority.organisationId,
              budgetUsd: step.budgetUsd,
            });
            if (result === undefined)
              return {
                status: "FAILED",
                summary: "Document preparation is unavailable.",
              };
            if (result.status === "READY") {
              if (!(await authority.canContinue()))
                return {
                  status: "FAILED",
                  summary:
                    "Document work stopped before completion was recorded.",
                };
              return {
                status: "DONE",
                summary: [
                  result.delivery === undefined
                    ? documentStepSummary(result.review)
                    : analysisStepSummary(result.delivery),
                  // Said plainly where the work stands (2026-10-25).
                  ...(publicSources === null
                    ? []
                    : [DOCUMENT_GAP_LINE[publicSources]]),
                ]
                  .join(" ")
                  .slice(0, 500),
                outputs: {
                  artifactId: result.artifactId,
                  ...(result.companyId === undefined
                    ? {}
                    : { companyId: result.companyId }),
                  ...(result.delivery === undefined
                    ? {}
                    : { delivery: result.delivery }),
                  ...(result.review === undefined
                    ? {}
                    : {
                        review: result.review,
                        // What the critic found that changes what comes next.
                        signals: reviewSignals(result.review, step.key),
                      }),
                },
              };
            }
            if (result.status === "FAILED" || result.status === "UNAVAILABLE") {
              return {
                status: "FAILED",
                summary: result.message.slice(0, 500),
              };
            }
            // PREPARING is still running, never a completed step or a policy hold.
            await polling.wait();
          }
          return {
            status: "FAILED",
            summary:
              "Document preparation did not finish before this run's deadline.",
          };
        };

  /**
   * DILIGENCE: founder questions from the document a step it waits on
   * prepared (the critique's when there is one), filed as the person's
   * approval card. DONE means filed or kept with the job, never sent.
   */
  const diligence: AgentExecutor | null =
    ports.diligence === undefined
      ? null
      : async (step, context) => {
          const authority = dependencies.documentContext;
          if (
            !has(step.tools, "diligence.questions.prepare") ||
            authority === undefined ||
            !authority.qRunId ||
            !authority.organisationId
          )
            return {
              status: "FAILED",
              summary: "The approved step or its authority is unavailable.",
            };
          // The latest document among what it waits on, and the critic's
          // findings about it when a critique ran.
          let source: { artifactId: string; companyId: string } | undefined;
          const critique: string[] = [];
          for (const key of step.dependsOn) {
            const outputs = context.results.get(key)?.outputs;
            const artifactId = outputs?.["artifactId"];
            const companyId = outputs?.["companyId"];
            if (typeof artifactId === "string" && typeof companyId === "string")
              source = { artifactId, companyId };
            const review = outputs?.["review"] as
              WorkforceDocumentReview | undefined;
            for (const issue of review?.issues ?? []) {
              if (
                issue.kind === "MISSING_INFORMATION" ||
                issue.kind === "MISSING_RISK" ||
                issue.kind === "UNSUPPORTED"
              )
                critique.push(`${issue.section}: ${issue.problem}`);
            }
          }
          if (source === undefined)
            return {
              status: "FAILED",
              summary: "No prepared document to draw the questions from.",
            };
          const result = await ports.diligence?.(owner, {
            canContinue: authority.canContinue,
            goal: step.goal,
            qRunId: authority.qRunId,
            jobId: context.jobId,
            stepKey: step.key,
            runId: context.runId,
            organisationId: authority.organisationId,
            source,
            critique,
          });
          if (result === undefined)
            return { status: "FAILED", summary: "Diligence is unavailable." };
          if ("message" in result)
            return { status: "FAILED", summary: result.message.slice(0, 500) };
          const count = result.questions.length;
          const words = `${String(count)} founder ${count === 1 ? "question" : "questions"}`;
          return {
            status: "DONE",
            summary:
              result.status === "CARDED"
                ? `Prepared ${words}; they wait for your approval before anything is sent.`
                : `Prepared ${words}; you are not connected yet, so they are kept here for when you are.`,
            outputs: {
              questions: result.questions,
              ...(result.status === "CARDED"
                ? { qActionId: result.qActionId }
                : {}),
            },
          };
        };

  /** DISCOVERY: companies newly matching the mandate, as a shortlist. */
  const discovery: AgentExecutor = async () => {
    const matches = (await ports.mandateMatches(owner)).slice(0, MAX_PER_STEP);
    return {
      status: "DONE",
      summary:
        matches.length === 0
          ? "No new companies match your mandate."
          : `Shortlisted ${plural(matches.length, "company", "companies")} matching your mandate.`,
      outputs: {
        shortlist: matches.map((match) => ({
          companyId: match.companyId,
          name: match.name,
        })),
      },
    };
  };

  /**
   * OUTREACH: interest expressed in the shortlist an earlier DISCOVERY
   * step made, or else in the companies matching the mandate now.
   */
  const outreach: AgentExecutor = async (step, context) => {
    if (!has(step.tools, "relationship.interest.express")) {
      return { status: "HELD", summary: "Not allowed to express interest." };
    }
    const shortlisted = step.dependsOn.flatMap(
      (key) =>
        ShortlistSchema.safeParse(
          context.results.get(key)?.outputs?.["shortlist"],
        ).data ?? [],
    );
    const companies = (
      shortlisted.length > 0 ? shortlisted : await ports.mandateMatches(owner)
    ).slice(0, MAX_PER_STEP);
    let expressed = 0;
    let failed = 0;
    for (const company of companies) {
      const done = await ports
        .expressInterest(
          owner,
          company.companyId,
          `wf:${context.jobId}:interest:${company.companyId}`,
        )
        .catch(() => ({ ok: false }));
      if (done.ok) expressed += 1;
      else failed += 1;
    }
    if (companies.length > 0 && expressed === 0) {
      return {
        status: "FAILED",
        summary: `Couldn't express interest in any of ${plural(companies.length, "company", "companies")}; nothing was sent.`,
        outputs: { expressed, failed },
      };
    }
    return {
      status: "DONE",
      summary:
        companies.length === 0
          ? "No companies to reach out to."
          : [
              `Expressed interest in ${plural(expressed, "company", "companies")}`,
              failed > 0 ? `${String(failed)} didn't go through` : null,
            ]
              .filter((part) => part !== null)
              .join("; ")
              .concat("."),
      outputs: { expressed, failed },
    };
  };

  /**
   * RESEARCH: bounded public-web research with sources. The note (the
   * query that left Capital Q and each source's address and title) is the
   * step's result, kept with the job. Pages are untrusted data: only
   * addresses and titles are kept, never their text.
   */
  const research: AgentExecutor | null =
    ports.research === undefined
      ? null
      : async (step, context) => {
          if (
            !has(step.tools, "public_web.search") ||
            ports.research === undefined
          ) {
            return { status: "HELD", summary: "Not allowed to research." };
          }
          const subject = diligenceSubjectFor(step.key, dependencies.steps);
          const found = await ports
            .research(owner, {
              jobId: context.jobId,
              runId: context.runId,
              request: (dependencies.goal ?? step.goal).slice(0, 2_000),
              query: step.goal.slice(0, 400),
              budgetUsd: step.budgetUsd,
              progress: dependencies.documentContext?.progress,
              ...(subject === null ? {} : { subject }),
            })
            .catch(() => null);
          // Production 2026-10-25: every research-backed document job failed
          // in 5 s with no draft while the public indexes rested. Public
          // sources that cannot be reached, or hold nothing, are a gap, not
          // a failure: the step completes, the steps after it go on from
          // Capital Q's own records, and the gap is said and stated. Only a
          // refusal (not theirs to research) stops it.
          if (found === null || found.status === "UNAVAILABLE") {
            const reason = found?.reason ?? "PUBLIC_UNAVAILABLE";
            if (reason === "NOT_ALLOWED") {
              return {
                status: "FAILED",
                summary: found?.message ?? "Not yours to research.",
              };
            }
            const gap = GAP_OF[reason];
            return {
              status: "DONE",
              summary: GAP_SUMMARY[gap],
              outputs: {
                note: { query: null, truthClass: "UNKNOWN", sources: [] },
                publicSources: gap,
              },
            };
          }
          return {
            status: "DONE",
            summary:
              found.dossier !== undefined
                ? `Read ${plural(found.dossier.sources.length, "public source", "public sources")} across ${plural(found.dossier.lanes.filter((lane) => lane.status === "OK").length, "line of enquiry", "lines of enquiry")}; kept ${plural(found.dossier.facts.length, "sourced fact", "sourced facts")}.`
                : found.sources.length === 0
                  ? "Found no public sources for this."
                  : `Found ${plural(found.sources.length, "public source", "public sources")}.`,
            outputs: {
              note: {
                query: found.query,
                truthClass: "UNKNOWN",
                sources: found.sources.slice(0, 12),
              },
              ...(found.dossier === undefined
                ? {}
                : { dossier: found.dossier }),
            },
          };
        };

  /**
   * Conversation and scheduling share one pass over open replies: each
   * reply is read by meaning, then answered warmly, or offered times, or
   * booked, or handed to the person.
   */
  const conversation =
    (mode: "REPLY" | "SCHEDULE"): AgentExecutor =>
    async (step, context) => {
      if (
        !has(
          step.tools,
          mode === "REPLY" ? "chat.message.send" : "schedule.meeting.book",
        )
      ) {
        return { status: "HELD", summary: "Not allowed to do this step." };
      }
      const principalName = await ports.principalName(owner);
      const open = (await ports.openConversations(owner)).slice(
        0,
        MAX_PER_STEP,
      );
      let replied = 0;
      let booked = 0;
      let held = 0;
      let handed = 0;
      let failed = 0;
      for (const one of open) {
        if (one.latest === null) continue;
        const latest = one.latest;
        const once =
          readings.get(latest.id) ??
          models.readReply(
            owner,
            { jobId: context.jobId, runId: context.runId },
            {
              principalName,
              counterpartName: one.counterpartName,
              thread: one.thread.slice(-4_000),
              latest: latest.text.slice(0, 4_000),
            },
          );
        readings.set(latest.id, once);
        const reading = await once;
        // Unreadable, a no, a not-now or an unhappy tone: the person's.
        if (
          reading === null ||
          stanceDeclines(reading.stance) ||
          reading.tone === "NEGATIVE"
        ) {
          if (mode === "REPLY") {
            handed += 1;
            await ports
              .notify(owner, {
                key: `wf:${context.jobId}:${one.latest.id}`,
                title:
                  reading === null
                    ? `Q couldn't read ${one.counterpartName}'s reply`
                    : `${one.counterpartName} may have said no`,
                body: "Q didn't reply. Read their message and answer yourself if you want to.",
              })
              .catch(() => undefined);
          }
          continue;
        }
        if (mode === "SCHEDULE") {
          if (!reading.wantsMeeting) continue;
          const slots = await ports.freeSlots(owner, one.relationshipId);
          const first = slots[0];
          if (first === undefined) continue;
          const result = await ports
            .book(
              owner,
              one.relationshipId,
              `wf:${context.jobId}:book:${one.relationshipId}`,
              first,
            )
            .catch(() => ({ ok: false, meetingId: null }));
          if (result.ok) booked += 1;
          continue;
        }
        if (reading.wantsMeeting && dependencies.scheduling) {
          // The scheduler books it; a reply now would cross with the invite.
          continue;
        }
        // D-09: the writer is given the step's goal as its brief (it was
        // handed an empty one), and the reviewer their latest words, so
        // thread consistency is checked.
        const draft = await ports.writeReply(
          owner,
          one,
          "WARM_REPLY",
          workforceCorrelationId(context.jobId, context.runId),
          step.goal,
        );
        if (draft === null) continue;
        const verdict = await review.review(
          owner,
          {
            kind: "DELEGATED_WORK",
            id: `job:${context.jobId}`,
            goal: step.goal,
          },
          {
            principalName,
            counterpartName: one.counterpartName,
            channel: "CHAT",
            stage: "REPLY",
            purpose: `A warm reply to ${one.counterpartName}'s latest message: ${step.goal}`,
            material: one.material,
            thread: one.thread,
            theirLatest: latest.text,
            body: draft,
          },
          { job: { jobId: context.jobId, parentRunId: context.runId } },
        );
        if (verdict.verdict === "HELD") {
          held += 1;
          // D-09: a held reply reaches the person, once per message.
          await ports
            .notify(owner, {
              key: `wf:${context.jobId}:held:${latest.id}`,
              title: `Q held a reply to ${one.counterpartName}`,
              body: heldLine(verdict, one.counterpartName),
            })
            .catch(() => undefined);
          continue;
        }
        const sent = await ports
          .send(
            owner,
            one.relationshipId,
            `wf:${context.jobId}:reply:${one.latest.id}`,
            verdict.body,
            context.jobId,
          )
          .catch(() => false);
        if (sent) {
          replied += 1;
          await review.settle(owner, verdict, "SENT");
        } else {
          failed += 1;
        }
      }
      if (mode === "SCHEDULE") {
        return {
          status: "DONE",
          summary:
            booked === 0
              ? "No calls to book yet."
              : `Booked ${plural(booked, "call", "calls")}.`,
          outputs: { booked },
        };
      }
      const summary = [
        `Replied to ${plural(replied, "person", "people")}`,
        held > 0
          ? `held ${plural(held, "draft", "drafts")} below the bar for you`
          : null,
        handed > 0
          ? `left ${plural(handed, "reply", "replies")} for you`
          : null,
        failed > 0 ? `${plural(failed, "reply", "replies")} didn't send` : null,
      ]
        .filter((part) => part !== null)
        .join("; ")
        .concat(".");
      // Honest end state: a held draft needs the person; a send that
      // failed with nothing sent is a failure, never "done".
      const status: StepResult["status"] =
        replied === 0 && failed > 0 ? "FAILED" : held > 0 ? "HELD" : "DONE";
      return { status, summary, outputs: { replied, held, handed, failed } };
    };

  return {
    DISCOVERY: discovery,
    OUTREACH: outreach,
    CONVERSATION: conversation("REPLY"),
    SCHEDULING: conversation("SCHEDULE"),
    ...(research === null ? {} : { RESEARCH: research }),
    ...(documents === null ? {} : { DOCUMENTS: documents }),
    ...(diligence === null ? {} : { DILIGENCE: diligence }),
  };
}

const ShortlistSchema = z
  .array(z.object({ companyId: z.string().min(1), name: z.string() }).strict())
  .max(MAX_PER_STEP);

export type StartJobResult =
  | {
      readonly outcome: "STARTED";
      readonly jobId: string;
      readonly summary: string;
      readonly steps: readonly {
        readonly key: string;
        readonly status: string;
        readonly summary: string;
      }[];
      readonly refused: readonly {
        readonly key: string;
        readonly reason: string;
      }[];
      readonly cannot: readonly string[];
    }
  | {
      readonly outcome: "NOT_PLANNED" | "PLAN_LIMIT";
      readonly jobId: string | null;
    };

/** The timeline's line for a document step, in plain words. */
export function documentStepSummary(
  review: WorkforceDocumentReview | undefined,
): string {
  if (review === undefined)
    return "Prepared the document; it is ready in your workspace.";
  const count = review.issues.length;
  const found =
    count === 0
      ? "found no material problem"
      : `found ${String(count)} ${count === 1 ? "issue" : "issues"}`;
  return review.revisedToVersion === null
    ? `Reviewed the document and ${found}; it stands as written.`
    : `Reviewed the document, ${found} and revised it to version ${String(review.revisedToVersion)}.`;
}

/**
 * The company a RESEARCH step researches for diligence: a later diligence
 * document in the approved plan that waits on it names it (bound by code
 * at planning). Null: an ordinary research step.
 */
export function diligenceSubjectFor(
  stepKey: string,
  steps: readonly BoundStep[] | undefined,
): { readonly companyId: string } | null {
  for (const step of steps ?? []) {
    const document = step.document;
    if (
      document !== undefined &&
      isWorkforceAnalysisRequest(document) &&
      document.scope === "NAMED_COMPANY" &&
      document.profile === WORKFORCE_DILIGENCE_PROFILE &&
      step.dependsOn.includes(stepKey)
    ) {
      return { companyId: document.companyId };
    }
  }
  return null;
}

/** The timeline's line for an ANALYSIS step, in plain words. */
export function analysisStepSummary(
  delivery: WorkforceDocumentDelivery,
): string {
  return delivery.passed
    ? `Wrote "${delivery.title.slice(0, 120)}"; a second analyst reviewed it and it passed.`
    : `Wrote "${delivery.title.slice(0, 120)}"; ${plural(delivery.openIssues, "reviewer point is", "reviewer points are")} still open and noted in it.`;
}

/** What the lead Q may plan with: the tools its specialists can carry out. */
export const EXECUTABLE_JOB_TOOLS: readonly string[] = [
  "search_companies",
  "list_my_relationships",
  "relationship.interest.express",
  "list_messages",
  "chat.message.send",
  "find_meeting_times",
  "list_schedule",
  "schedule.meeting.book",
];

/** The tools the lead Q may plan with here: research only where composed. */
export function executableJobTools(
  research: boolean,
  documents = false,
  diligence = false,
): readonly string[] {
  return [
    ...EXECUTABLE_JOB_TOOLS,
    ...(research ? ["public_web.search"] : []),
    ...(documents ? ["documents.own.prepare"] : []),
    ...(diligence ? ["diligence.questions.prepare"] : []),
  ];
}

/**
 * D3: a durable job's memory across restarts -- each finished step's
 * result, so a resumed job never redoes one -- kept by the work queue.
 */
export type DurableSteps = {
  readonly prior: (stepKey: string) => Promise<PriorRun | null>;
  readonly record: (
    stepKey: string,
    result: StepResult,
    runId: string,
  ) => Promise<void>;
};

/** Why code refused a step, in words the lead reads when it replans. */
const REFUSAL_WORDS: Readonly<Record<StepRefusal, string>> = {
  UNKNOWN_ROLE: "that role does not exist here",
  LEAD_IS_NOT_A_STEP: "the lead is never a step",
  NO_EXECUTOR: "no agent here carries out that role",
  NO_PERMITTED_TOOL: "none of its tools is that role's and allowed",
  MISSING_REQUIRED_TOOL:
    "it lacks the tool its role acts through (see 'must include' in the roster); a step that only reads does nothing",
  INVALID_DOCUMENT_REQUEST: "its document request is not valid for that role",
  NO_NAMED_COMPANY: "the job names no single company on record",
  INVALID_CRITIQUE_SOURCE:
    "a critique must name an earlier PREPARE step it waits on",
  WAITS_ON_MISSING_STEP: "it waits on a step that is not in the plan before it",
  INVALID_FALLBACK:
    "a fallback must cover one earlier ordinary step, never wait on it, and nothing may wait on a fallback",
  DUPLICATE_KEY: "its key is used twice",
  OVER_BUDGET: "the job's budget is used up before it",
  TOO_MANY_STEPS: "the plan has too many steps",
};

/** The default budget of one job the lead Q proposes, USD. */
export const DEFAULT_JOB_BUDGET_USD = 0.5;

export type PlannedJob = {
  readonly summary: string;
  readonly steps: readonly BoundStep[];
  readonly refused: readonly {
    readonly key: string;
    readonly reason: string;
  }[];
  readonly cannot: readonly string[];
  /** wf: the lead's grounded reasoning; absent on older approved plans. */
  readonly reasoning?: WorkforceJobReasoning | undefined;
  /** Evidence references the planner gave that were not facts (dropped). */
  readonly droppedRefs?: number | undefined;
  /** Owner 2026-10-23: Q's first read, said while the work runs. */
  readonly firstRead?: string | null | undefined;
};

export function createWorkforceJobs(dependencies: {
  readonly store: WorkforceStore;
  readonly models: Pick<WorkforceModels, "plan" | "readReply">;
  readonly review: OutwardReview;
  readonly ports: WorkforcePorts;
  /** J6: one unit of `q.agent_jobs` per job; false is the plan's limit. */
  readonly meter?:
    ((owner: Owner, idempotencyKey: string) => Promise<boolean>) | undefined;
  /** J6: whether this month's spend leaves room for a new job. */
  readonly withinLimit?: ((owner: Owner) => Promise<boolean>) | undefined;
  readonly logger?: Logger | undefined;
}) {
  const { store } = dependencies;

  /** The lead Q's plan, bounded by what is permitted and the budget. */
  async function plan(
    owner: Owner,
    input: {
      readonly goal: string;
      readonly permitted: readonly string[];
      readonly budgetUsd: number;
      /** The one company the goal names, resolved as the person. */
      readonly namedCompany?:
        | { readonly companyId: string; readonly name: string }
        | null
        | undefined;
      /** What code read from their records for this job (authorised). */
      readonly situation?: JobSituation | undefined;
    },
    trace: { readonly jobId: string; readonly runId: string } | null,
  ): Promise<PlannedJob | null> {
    const situation = input.situation ?? EMPTY_SITUATION;
    const permitted = new Set(input.permitted);
    // D1: the roster is what this deployment really runs, nothing more.
    const executors = registeredExecutors({
      research: dependencies.ports.research !== undefined,
      documents: dependencies.ports.documents !== undefined,
      diligence: dependencies.ports.diligence !== undefined,
    });
    const allowed = `Tools and actions: ${[...permitted].join(", ") || "none"}. Budget for the whole job: $${input.budgetUsd.toFixed(2)}.${
      input.namedCompany == null
        ? " The job names no single company on record, so a NAMED_COMPANY document cannot be planned."
        : ` The company the job names is on record${input.namedCompany.name === "" ? "" : `: ${input.namedCompany.name.slice(0, 120)}`}.`
    }`;
    const attempt = async (feedback: string) => {
      const planned = await dependencies.models.plan(owner, trace, {
        goal: input.goal.slice(0, 2_000),
        roster: executorRosterText(executors, permitted),
        allowed: `${allowed}${feedback}`.slice(0, 2_000),
        situation: situationText(situation).slice(0, 8_000),
      });
      if (planned === null) return null;
      let droppedRefs = 0;
      const bound = boundPlan(
        planned.steps.map((step) => {
          // Only facts the lead was shown may stand behind a step.
          const grounded = groundStepEvidence(step.evidence, situation);
          droppedRefs += grounded.dropped;
          return {
            key: step.key,
            role: step.role,
            agentName: null,
            goal: step.goal,
            tools: step.tools,
            dependsOn: step.dependsOn,
            ...(step.document === undefined ? {} : { document: step.document }),
            why: step.why,
            evidence: grounded.evidence,
            ...(step.fallbackFor === null
              ? {}
              : { fallbackFor: step.fallbackFor }),
          };
        }),
        {
          permitted,
          // The lead's own planning comes out of the same budget.
          budgetUsd: Math.max(
            0,
            input.budgetUsd - AGENT_REGISTRY.LEAD.budgetUsd,
          ),
          executors,
          namedCompanyId: input.namedCompany?.companyId ?? null,
        },
      );
      return { planned, bound, droppedRefs };
    };
    let made = await attempt("");
    if (made === null) return null;
    if (!planIsValid(made.bound) && made.bound.refused.length > 0) {
      // Replanning before approval: the lead hears, in code's words, why
      // each step was refused and plans once more. A plan still refused is
      // never offered (D-02), and nothing has run either way.
      dependencies.logger?.info(
        { refused: made.bound.refused, steps: made.bound.steps.length },
        "workforce plan refused before approval; replanning once",
      );
      const again = await attempt(
        ` YOUR LAST PLAN WAS REFUSED BY CODE, step by step: ${made.bound.refused
          .map((one) => `${one.key}: ${REFUSAL_WORDS[one.reason]}`)
          .join(
            "; ",
          )}. Plan again: fix those steps, or put what no role can do in cannot.`,
      );
      if (again !== null) made = again;
    }
    const { planned, bound, droppedRefs } = made;
    if (!planIsValid(bound)) {
      // Refused whole, before anyone is asked to approve it (D-02).
      dependencies.logger?.info(
        { refused: bound.refused, steps: bound.steps.length },
        "workforce plan refused before approval",
      );
    }
    const grounded = groundReasoning(planned, situation, bound.steps);
    return {
      summary: planned.summary,
      steps: bound.steps,
      refused: bound.refused,
      cannot: planned.cannot,
      reasoning: grounded.reasoning,
      droppedRefs: droppedRefs + grounded.droppedRefs,
      firstRead: planned.firstRead ?? null,
    };
  }

  /** Files the job for its source (one per source), with its lead run. */
  async function file(
    owner: Owner,
    input: {
      readonly goal: string;
      readonly budgetUsd: number;
      readonly source: {
        readonly kind: "JOB" | "INSTRUCTION" | "DELEGATED_WORK";
        readonly id: string;
      };
    },
  ): Promise<{ readonly jobId: string; readonly leadRunId: string }> {
    const one = await store.ensureJob(owner, {
      source: input.source,
      goal: input.goal,
      budgetUsd: input.budgetUsd,
      threshold: DEFAULT_REVIEW_POLICY.threshold,
      // D-14: the redrafts the review loop really allows.
      maxRedrafts: DEFAULT_REVIEW_POLICY.maxRedrafts,
      rubricVersion: RUBRIC_VERSION,
    });
    return { jobId: one.job.id, leadRunId: one.leadRunId };
  }

  /**
   * The month's limit and the plan's agent-job allowance, checked before
   * anything is planned or run; false holds the job with the reason.
   */
  async function gate(
    owner: Owner,
    filed: { readonly jobId: string; readonly leadRunId: string },
  ): Promise<boolean> {
    const hold = async (summary: string) => {
      await store.endRun(owner, filed.leadRunId, "HELD", summary);
      await store.setJobStatus(owner, filed.jobId, "HELD");
    };
    if (dependencies.withinLimit !== undefined) {
      const room = await dependencies.withinLimit(owner).catch(() => null);
      if (!room) {
        await hold(
          room === null
            ? "I couldn't check this month's spending for Q's work. The job is held until spending can be checked."
            : "This month's limit for Q's work is reached; raise it to go on.",
        );
        return false;
      }
    }
    if (dependencies.meter !== undefined) {
      const allowed = await dependencies
        .meter(owner, `wf:${filed.jobId}`)
        .catch(() => false);
      if (!allowed) {
        await hold("Your plan's agent jobs for this month are used up.");
        return false;
      }
    }
    return true;
  }

  /**
   * Carries out a plan already bound (and, for a proposed job, approved):
   * never re-planned here. Files the job for its source, checks the plan's
   * agent-job allowance and the month's limit, then runs agent by agent.
   */
  async function run(
    owner: Owner,
    input: {
      readonly goal: string;
      readonly budgetUsd: number;
      readonly source: {
        readonly kind: "JOB" | "INSTRUCTION" | "DELEGATED_WORK";
        readonly id: string;
      };
      readonly planned: PlannedJob;
    },
    filedAlready?: { readonly jobId: string; readonly leadRunId: string },
    options: {
      readonly gated?: boolean | undefined;
      readonly documentContext?: DocumentExecutionContext | undefined;
      /** D3: resume from, and keep, each finished step's result. */
      readonly durable?: DurableSteps | undefined;
    } = {},
  ): Promise<StartJobResult> {
    const filed = filedAlready ?? (await file(owner, input));
    if (options.gated !== true && !(await gate(owner, filed))) {
      return { outcome: "PLAN_LIMIT", jobId: filed.jobId };
    }
    const { jobId, leadRunId } = filed;
    const { planned } = input;
    const result = await runJob({
      jobId,
      goal: planned.summary,
      onStepError: ({ stepKey, runId, error }) =>
        dependencies.logger?.warn(
          { err: error, jobId, stepKey, runId },
          "workforce step executor threw; the step is FAILED",
        ),
      steps: planned.steps,
      executors: withDurableResults(
        createWorkforceExecutors({
          owner,
          ports: dependencies.ports,
          models: dependencies.models,
          review: dependencies.review,
          scheduling: planned.steps.some((step) =>
            step.tools.includes("schedule.meeting.book"),
          ),
          goal: input.goal,
          steps: planned.steps,
          documentContext: options.documentContext,
        }),
        options.durable,
      ),
      recorder: {
        ...recorderFor(store, owner),
        // The lead is the job's lead run, not a second one.
        startRun: (one) =>
          one.role === "LEAD"
            ? Promise.resolve(leadRunId)
            : recorderFor(store, owner).startRun(one),
        ...(options.durable === undefined
          ? {}
          : {
              prior: (_jobId: string, stepKey: string) =>
                options.durable?.prior(stepKey) ?? Promise.resolve(null),
            }),
      },
    });
    await store.setJobStatus(owner, jobId, jobStatusOf(result.steps));
    return {
      outcome: "STARTED",
      jobId,
      summary: planned.summary,
      steps: result.steps.map((step) => ({
        key: step.key,
        status: step.status,
        summary: step.summary,
      })),
      refused: planned.refused,
      cannot: planned.cannot,
    };
  }

  return {
    /** Whether RESEARCH is registered here (a research provider is composed). */
    research: dependencies.ports.research !== undefined,
    documents: dependencies.ports.documents !== undefined,
    diligence: dependencies.ports.diligence !== undefined,

    plan: (
      owner: Owner,
      input: {
        readonly goal: string;
        readonly permitted: readonly string[];
        readonly budgetUsd: number;
        readonly namedCompany?:
          | { readonly companyId: string; readonly name: string }
          | null
          | undefined;
        readonly situation?: JobSituation | undefined;
      },
    ) => plan(owner, input, null),

    file,
    run,

    /**
     * Plan and carry out one job the person approved. `permitted` is the
     * job's grant (tool and action names); `source` ties it to what it was
     * approved under, so a replay is the same job.
     */
    start: async (
      owner: Owner,
      input: {
        readonly goal: string;
        readonly permitted: readonly string[];
        readonly budgetUsd: number;
        readonly source: {
          readonly kind: "JOB" | "INSTRUCTION" | "DELEGATED_WORK";
          readonly id: string;
        };
      },
    ): Promise<StartJobResult> => {
      const filed = await store.ensureJob(owner, {
        source: input.source,
        goal: input.goal,
        budgetUsd: input.budgetUsd,
        threshold: DEFAULT_REVIEW_POLICY.threshold,
        maxRedrafts: DEFAULT_REVIEW_POLICY.maxRedrafts,
        rubricVersion: RUBRIC_VERSION,
      });
      const jobId = filed.job.id;
      const lead = { jobId, leadRunId: filed.leadRunId };
      if (!(await gate(owner, lead))) {
        return { outcome: "PLAN_LIMIT", jobId };
      }
      const planned = await plan(owner, input, {
        jobId,
        runId: filed.leadRunId,
      });
      if (planned === null || !planIsValid(planned)) {
        await store.endRun(
          owner,
          filed.leadRunId,
          "HELD",
          planned === null
            ? "Couldn't plan this job just now."
            : "The plan named work no agent here can do, so nothing ran.",
        );
        await store.setJobStatus(owner, jobId, "HELD");
        return { outcome: "NOT_PLANNED", jobId };
      }
      return run(owner, { ...input, planned }, lead, { gated: true });
    },
  };
}

export type WorkforceJobs = ReturnType<typeof createWorkforceJobs>;

/**
 * Founder brief J5: standing instructions and delegated work are Q's jobs
 * too -- the same job record, one per source, shown on the workforce page
 * as it runs. Best effort: a record that cannot be written never stops the
 * work it describes.
 */
export function workforceTracker(
  store: WorkforceStore,
  kind: "INSTRUCTION" | "DELEGATED_WORK",
) {
  return async (
    owner: Owner,
    source: { readonly id: string; readonly goal: string },
    /**
     * D-11: "START" when a firing begins, "END" when it is over (DONE, or
     * HELD while something waits on the person). Before, these jobs were
     * set RUNNING and never left it, so the page said "Working" forever.
     */
    phase: "START" | "END" = "START",
    waitingOnPerson = false,
  ): Promise<void> => {
    const filed = await store.ensureJob(owner, {
      source: { kind, id: source.id },
      goal: source.goal,
      budgetUsd: DEFAULT_JOB_BUDGET_USD,
      threshold: DEFAULT_REVIEW_POLICY.threshold,
      maxRedrafts: DEFAULT_REVIEW_POLICY.maxRedrafts,
      rubricVersion: RUBRIC_VERSION,
    });
    // The lead run of such a job is not work happening: it ends at once,
    // saying what the job is, so nothing shows "Working" between firings.
    await store.endRun(
      owner,
      filed.leadRunId,
      "DONE",
      kind === "INSTRUCTION"
        ? "Q works on this on your instruction's schedule; each step is recorded here."
        : "Q works on this under your approval; each step is recorded here.",
    );
    await store.setJobStatus(
      owner,
      filed.job.id,
      phase === "START" ? "RUNNING" : waitingOnPerson ? "HELD" : "DONE",
    );
  };
}

/** A job's status from its steps: DONE only when every step is done. */
export function jobStatusOf(
  all: readonly {
    readonly status: string;
    readonly counts?: boolean | undefined;
  }[],
): "DONE" | "HELD" | "FAILED" {
  // A fallback not needed, or a step a fallback stood in for, does not count.
  const steps = all.filter((step) => step.counts !== false);
  if (steps.length === 0) return "HELD";
  if (steps.every((step) => step.status === "DONE")) return "DONE";
  if (steps.some((step) => step.status === "HELD")) return "HELD";
  return steps.some((step) => step.status === "FAILED") ? "FAILED" : "HELD";
}

/** Each step's result kept as it finishes, so a restart never redoes it. */
function withDurableResults(
  executors: Partial<Record<QAgentRole, AgentExecutor>>,
  durable: DurableSteps | undefined,
): Partial<Record<QAgentRole, AgentExecutor>> {
  if (durable === undefined) return executors;
  return Object.fromEntries(
    Object.entries(executors).map(([role, executor]) => [
      role,
      async (step: BoundStep, context: Parameters<AgentExecutor>[1]) => {
        const result = await executor(step, context);
        await durable.record(step.key, result, context.runId);
        return result;
      },
    ]),
  );
}
