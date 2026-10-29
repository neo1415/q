import type { Logger } from "@capital-q/observability";
import { createHash } from "node:crypto";

import {
  isWorkforceAnalysisRequest,
  QRunIdSchema,
  WORKFORCE_ANALYSIS_KIND,
  WORKFORCE_DILIGENCE_PROFILE,
  type QArtifactContent,
  type QArtifactSummary,
  type QSubjectRef,
  type WorkforceAnalysisRequest,
} from "@capital-q/contracts";
import { createCorrelationId } from "@capital-q/observability";
import type { ArtifactService } from "@capital-q/q-artifacts";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import {
  prepareOrReviseArtifact,
  type ArtifactPreparation,
  type CompanyIntelligenceRequest,
  type CompanyIntelligenceResult,
  type QSpecialistExecutionContext,
} from "@capital-q/q-specialists";
import type { ActorContext } from "@capital-q/security";

import type {
  WorkforceDocumentInput,
  WorkforceDocumentResult,
} from "./jobs.js";
import {
  REVIEWER_OPEN_POINT,
  analysisContent,
  investigationGaps,
  investigationSections,
  mergeDossiers,
  recordsText,
  researchText,
  sourcesText,
  writeAnalysisWithReview,
} from "./analysis.js";
import {
  claimsSection,
  matchClaims,
  type ClaimRow,
  type CompanyClaim,
} from "./claims.js";
import { createSpend } from "./deep-research.js";
import {
  BUDGET_LIMITED_GAP,
  NO_RESEARCH_GAP,
  dataRoomText,
  diligenceContent,
  heldBackGap,
  diligencePurpose,
  orderDiligenceDraft,
  readDataRoom,
  type DataRoomReads,
} from "./diligence-memo.js";
import { safeReport } from "./live.js";
import type { OwnContextFocus } from "./own-context.js";
import type { WorkforceModels } from "./models.js";

/** The marker a reviewer's revision carries, so a retry never revises twice. */
export const REVIEWER_REVISION_PREFIX = "Second-specialist review:";

const CRITIQUE_DOCUMENT_MAX = 24_000;
const CRITIQUE_EVIDENCE_MAX = 12_000;

/** The document as the critic reads it: headings, prose and stated gaps. */
export function critiqueText(content: {
  readonly sections: readonly {
    readonly heading: string;
    readonly body: string;
  }[];
  readonly gaps: readonly string[];
}): string {
  const body = content.sections
    .map((section) => `## ${section.heading}\n${section.body}`)
    .join("\n\n");
  const gaps =
    content.gaps.length === 0
      ? ""
      : `\n\n## Stated as not known\n${content.gaps.map((gap) => `- ${gap}`).join("\n")}`;
  return `${body}${gaps}`.slice(0, CRITIQUE_DOCUMENT_MAX);
}

/**
 * Approved document work through Q's existing evidence and artifact
 * pipeline: a document about the person's own company, a memo about the
 * one company the job named (bound by code at planning), or a second
 * specialist's critique and revision of a document an earlier step made.
 */
export function createWorkforceDocuments(dependencies: {
  readonly freshActor: (actor: ActorContext) => Promise<ActorContext | null>;
  readonly ownCompany: (
    actor: ActorContext,
  ) => Promise<{ readonly companyId: string } | null>;
  readonly firewall: ContextFirewallPort;
  readonly investigate: (
    request: CompanyIntelligenceRequest,
    context: QSpecialistExecutionContext,
  ) => Promise<CompanyIntelligenceResult>;
  readonly artifacts: Pick<
    ArtifactService,
    "findWorkforceDocument" | "requestDocument"
  >;
  readonly preparation: ArtifactPreparation;
  /** The second specialist; absent: critique steps cannot run here. */
  readonly critic?: WorkforceModels["critique"] | undefined;
  /**
   * Live 2026-10-12: a named-company memo failed in 1.3 s with no trace,
   * because both failure paths here were silent. A failed step now says
   * which error stopped it (class and message only, never the content).
   */
  readonly logger?: Logger | undefined;
  /** Owner 2026-10-23: the analyst and its reviewer (ANALYSIS documents). */
  readonly analyst?:
    Pick<WorkforceModels, "writeAnalysis" | "critiqueAnalysis"> | undefined;
  readonly now?: (() => number) | undefined;
  /**
   * Owner QA 2026-10-23 (QO-07): the person's own context -- an investor's
   * organisation, mandates and pipeline; a founder's investor pipeline --
   * read as them (own-context.ts). An analysis is written for them.
   */
  readonly ownContext?:
    | ((actor: ActorContext, focus?: OwnContextFocus) => Promise<string | null>)
    | undefined;
  /**
   * Diligence (2026-10-28): the company's data room, through its own view
   * read AS the person. Absent: a diligence memo says none was read.
   */
  readonly dataRoom?: DataRoomReads | undefined;
}) {
  /**
   * An ANALYSIS document: the company's own record read as the person
   * (none for GENERAL), the research steps' admitted facts, written and
   * reviewed until it passes, then filed as the person's organisation's
   * own document. Founder-private facts reach it only when the person may
   * read them -- their own company -- and it is private to them.
   */
  /**
   * The step's document as an earlier attempt filed it. What Q says when it
   * lands is read back from it: its title and summary, and whether the
   * reviewer left points open (they are in its "not known" list).
   */
  async function resumed(
    actor: ActorContext,
    artifactId: string,
    companyId: string | null,
  ): Promise<WorkforceDocumentResult> {
    const current = await dependencies.preparation.port.currentVersion(
      actor,
      artifactId,
    );
    if (current === null)
      return {
        status: "UNAVAILABLE",
        message: "This analysis can no longer be read as you.",
      };
    const open = current.content.gaps.filter((gap) =>
      gap.startsWith(REVIEWER_OPEN_POINT),
    ).length;
    return {
      status: "READY",
      artifactId,
      ...(companyId === null ? {} : { companyId }),
      delivery: {
        title: current.title,
        artifactType: WORKFORCE_ANALYSIS_KIND,
        summary: current.summary,
        topRecommendations: [],
        passed: open === 0,
        openIssues: open,
      },
    };
  }

  async function prepareAnalysis(
    actor: ActorContext,
    input: WorkforceDocumentInput,
    request: WorkforceAnalysisRequest,
  ): Promise<WorkforceDocumentResult> {
    const unavailable = (): WorkforceDocumentResult => ({
      status: "UNAVAILABLE",
      message: "This analysis cannot be prepared with the current authority.",
    });
    const analyst = dependencies.analyst;
    if (analyst === undefined)
      return { status: "FAILED", message: "No analyst is available here." };
    const companyId =
      request.scope === "OWN_COMPANY"
        ? ((await dependencies.ownCompany(actor))?.companyId ?? null)
        : request.scope === "NAMED_COMPANY"
          ? request.companyId
          : null;
    // An investor's "own" plan has no company of theirs: it is written
    // from their own context (ownContext) alone, never refused.
    if (request.scope === "NAMED_COMPANY" && companyId === null)
      return unavailable();
    const subject: Extract<QSubjectRef, { kind: "COMPANY" }> | null =
      companyId === null ? null : { kind: "COMPANY", companyId };
    // Diligence (2026-10-28): fixed sections, the data room as they may
    // read it, and claims set against evidence by code.
    const diligence =
      request.scope === "NAMED_COMPANY" &&
      request.profile === WORKFORCE_DILIGENCE_PROFILE;
    const claims: CompanyClaim[] = [];
    const recordContradictions: (readonly string[])[] = [];
    const codeGaps: string[] = [];
    let dataRoomPassages = 0;
    const runId = QRunIdSchema.parse(input.qRunId);
    const correlationId = createCorrelationId();
    const authorise = async (who: ActorContext) =>
      dependencies.firewall.plan({
        actor: who,
        runId,
        correlationId,
        capability: "ANSWER",
        subjects: subject === null ? [] : [subject],
      });
    const decision = await authorise(actor);
    if (decision.outcome !== "AUTHORISED") return unavailable();
    // Filed at most once per (job, step): a retry after a crash finds the
    // document an earlier attempt filed and neither rewrites nor refiles it.
    const workforce = {
      jobId: input.jobId,
      stepKey: input.stepKey,
      intentSha256: createHash("sha256")
        .update(
          JSON.stringify({
            request,
            goal: input.goal,
            qRunId: input.qRunId,
            tenantId: actor.tenantId,
            userId: actor.userId,
            organisationId: actor.organisationId,
            companyId,
          }),
        )
        .digest("hex"),
    };
    const prior = await dependencies.artifacts.findWorkforceDocument({
      actorContext: actor,
      permittedContextPlan: decision.plan,
      qRunId: runId,
      ...(subject === null ? {} : { subject }),
      artifactType: WORKFORCE_ANALYSIS_KIND,
      workforce,
    });
    if (prior !== null && prior.status === "READY" && prior.currentVersion > 0)
      return resumed(actor, prior.artifactId, companyId);
    // The company's own record, as the person may read it (the firewall
    // filtered it before any model sees it).
    let company =
      "No company record: this analysis is about a market or question, not one company.";
    let companyName: string | null = null;
    if (subject !== null) {
      if (!(await input.canContinue())) return unavailable();
      const read = await dependencies.investigate(
        {
          company: subject,
          question: input.goal,
          preparationMode: "EVIDENCE_ONLY",
          publicResearch: false,
        },
        {
          actor,
          runId,
          correlationId,
          capability: "ANSWER",
          plan: decision.plan,
        },
      );
      if (read.blocked !== null || read.companyId !== companyId)
        return unavailable();
      companyName = read.companyName ?? null;
      const lines = [
        ...(read.companyName == null ? [] : [`Company: ${read.companyName}`]),
        ...(read.canonicalDescription == null
          ? []
          : [`Its own description: ${read.canonicalDescription}`]),
        ...read.findings.map(
          (finding) =>
            `- (${finding.truthClass}, ${finding.evidenceStatus}) ${finding.statement}`,
        ),
        // Contradictions coexist (2026-10-28): the specialist computed them
        // and they were dropped; every side is kept, labelled.
        ...read.contradictions.map(
          (set) =>
            `- (CONTRADICTORY on record, both kept) ${set.statements.join(" | ")}`,
        ),
      ];
      company =
        lines.length === 0
          ? "The company's record holds nothing yet; say what is not known."
          : lines.join("\n");
      if (diligence && subject !== null) {
        claims.push(
          ...read.findings
            .filter(
              (finding) =>
                finding.truthClass === "USER_CLAIM" ||
                finding.evidenceStatus === "SELF_REPORTED",
            )
            .map((finding) => ({
              statement: finding.statement,
              source: "its record",
              truthClass: finding.truthClass,
              evidenceStatus: finding.evidenceStatus,
            })),
        );
        recordContradictions.push(
          ...read.contradictions.map((set) => set.statements),
        );
      }
      // The data room, as THIS person may open it (its own view decides,
      // read as them; never a privileged read, never founder-private).
      // Stress 2026-10-28 (F03, S02 follow-up): read for every analysis of
      // a company. The founder's review of "the deck and financials I
      // uploaded" said the material held no deck, and an investor's "can I
      // trust the deck?" job said no MRR was available, because only a
      // diligence memo read the room. Claims are matched only there.
      if (dependencies.dataRoom !== undefined) {
        if (!(await input.canContinue())) return unavailable();
        const room = await readDataRoom(
          dependencies.dataRoom,
          actor,
          subject.companyId,
        );
        dataRoomPassages = room.passages.length;
        if (diligence)
          claims.push(...room.passages.flatMap((one) => one.claims));
        for (const title of room.heldBack)
          codeGaps.push(heldBackGap(title, request.scope === "OWN_COMPANY"));
        if (room.heldBack.length > 0)
          company = `${company}\n\nHELD BACK FROM Q (classified highly confidential; never read, no model received them; say so wherever figures or contradictions come up, and that their figures become usable once the founder confirms them): ${room.heldBack.map((title) => `"${title.slice(0, 160)}"`).join(", ")}`;
        const text = dataRoomText(room.passages);
        if (text.length > 0) company = `${company}\n\n${text}`;
        if (room.passages.length === 0)
          codeGaps.push(
            room.available
              ? "No data-room document open to you held readable text, so none was read."
              : "The company's data room could not be read as you, so none of its documents were used.",
          );
        if (room.notOpen > 0)
          codeGaps.push(
            `${String(room.notOpen)} data-room document${room.notOpen === 1 ? " is" : "s are"} listed but not open to you, so ${room.notOpen === 1 ? "it was" : "they were"} not read.`,
          );
      }
    }
    const merged = mergeDossiers(input.research ?? []);
    // Owner 2026-10-29: research starts from everything Q knows about the
    // person. When a research step wrote a brief from their situation, the
    // writer reads it (the facts it selected and the sections it drew on:
    // a thesis from their declared mandate, exposure from their own
    // record) instead of a second, thinner read of the same records.
    const briefed = merged.briefs.length > 0;
    if (briefed) {
      company = `${company}\n\nWHAT THIS QUESTION NEEDS, as Q briefed it from everything it holds about ${input.principalName ?? "the person"} (their own records, read as them; private):\n${merged.briefs.join("\n\n").slice(0, 16_000)}`;
    }
    // Whoever it is for: their own context, read as them (with a brief,
    // only what it cannot hold: the history of a relationship in focus).
    const theirs = await dependencies
      .ownContext?.(actor, {
        companyId,
        goal: `${input.personRequest ?? ""} ${input.goal}`,
        briefed,
      })
      .catch(() => null);
    if (theirs != null && theirs.length > 0) {
      company = `${company}\n\nWHO THIS IS FOR (${input.principalName ?? "the person"}), from their own records:\n${theirs}`;
    }
    if (merged.budgetLimited) codeGaps.unshift(BUDGET_LIMITED_GAP);
    // Investigation (2026-10-29): Capital Q's own records the person may
    // see, labelled apart from web facts, and what stayed open.
    const records = recordsText(merged.records);
    if (records.length > 0) company = `${company}\n\n${records}`;
    codeGaps.push(...investigationGaps(merged.investigations));
    if (
      diligence &&
      (input.research ?? []).length === 0 &&
      input.publicSources === undefined
    )
      codeGaps.unshift(NO_RESEARCH_GAP);
    const spend = createSpend(input.budgetUsd);
    const today = new Date((dependencies.now ?? Date.now)())
      .toISOString()
      .slice(0, 10);
    const written = await writeAnalysisWithReview({
      models: analyst,
      who: { tenantId: actor.tenantId, userId: actor.userId },
      trace: { jobId: input.jobId, runId: input.runId },
      spend,
      canContinue: input.canContinue,
      progress: safeReport(input.progress),
      inputs: {
        principalName: input.principalName ?? "the person",
        request: input.personRequest ?? input.goal,
        purpose: diligence
          ? diligencePurpose(companyName, input.goal)
          : input.goal,
        today,
        company,
        research: researchText(merged.facts, input.publicSources ?? null),
        sources: sourcesText(merged.sources),
        sourceIndices: new Set(merged.sources.map((source) => source.index)),
      },
    });
    if (written === null)
      return {
        status: "FAILED",
        message: "The analysis could not be written; nothing was filed.",
      };
    if (!(await input.canContinue())) return unavailable();
    safeReport(input.progress)({ stage: "FILING" });
    const seed = `${input.jobId}:${input.stepKey}`;
    let content: QArtifactContent;
    let claimRows: readonly ClaimRow[] = [];
    if (diligence) {
      const ordered = orderDiligenceDraft(written.draft);
      claimRows = matchClaims({
        companyName,
        claims,
        evidence: merged.facts.map((fact) => ({
          statement: fact.statement,
          sourceIndex: fact.source,
          domain: fact.domain,
          asOf: fact.asOf,
        })),
        recordContradictions,
      });
      const section = claimsSection(claimRows, seed);
      content = diligenceContent({
        content: analysisContent({
          draft: ordered.draft,
          review: written.review,
          sources: merged.sources,
          facts: merged.facts,
          seed,
          publicSources: input.publicSources ?? null,
          alsoCites: [section.body],
          codeGaps,
          sourcesAlways: true,
        }),
        claims: {
          heading: section.heading,
          body: section.body,
          findings: [...section.findings],
        },
      });
    } else {
      content = analysisContent({
        draft: written.draft,
        review: written.review,
        sources: merged.sources,
        facts: merged.facts,
        seed,
        publicSources: input.publicSources ?? null,
        codeGaps,
        codeSections: investigationSections({
          facts: merged.facts,
          investigations: merged.investigations,
        }),
      });
    }
    // Filed under a fresh decision, as the person now.
    const refreshed = await dependencies.freshActor(actor);
    if (
      refreshed === null ||
      refreshed.userId !== actor.userId ||
      refreshed.tenantId !== actor.tenantId ||
      refreshed.organisationId !== actor.organisationId
    )
      return unavailable();
    const fresh = await authorise(refreshed);
    if (fresh.outcome !== "AUTHORISED") return unavailable();
    const filed = await dependencies.preparation.port.prepare({
      actorContext: refreshed,
      permittedContextPlan: fresh.plan,
      qRunId: runId,
      ...(subject === null ? {} : { subject }),
      artifactType: WORKFORCE_ANALYSIS_KIND,
      content: {
        title: written.draft.title,
        summary: written.draft.summary,
        content,
      },
      workforce,
    });
    dependencies.logger?.info(
      {
        jobId: input.jobId,
        stepKey: input.stepKey,
        drafts: written.review.drafts,
        passed: written.review.passes,
        issuesFound: written.review.found.length,
        issuesOpen: written.review.open.length,
        facts: merged.facts.length,
        spentUsd: Number(spend.spent().toFixed(4)),
        named: companyName !== null,
        diligence,
        dataRoomPassages,
        claims: claimRows.length,
        contradicted: claimRows.filter((row) => row.status === "CONTRADICTED")
          .length,
        budgetLimited: merged.budgetLimited,
      },
      "workforce analysis filed",
    );
    return {
      status: "READY",
      artifactId: filed.artifactId,
      ...(companyId === null ? {} : { companyId }),
      review: {
        material: written.review.found.length > 0,
        issues: written.review.found.map((issue) => ({
          kind: issue.kind,
          section: issue.section,
          problem: issue.problem,
        })),
        revisedToVersion: null,
      },
      delivery: {
        title: written.draft.title,
        artifactType: WORKFORCE_ANALYSIS_KIND,
        summary: written.draft.summary,
        topRecommendations: written.draft.topRecommendations.slice(0, 3),
        passed: written.review.passes,
        openIssues: written.review.open.length,
      },
    };
  }

  /**
   * The second specialist. It reads the version the person may read now
   * (re-authorised), against the findings the document was built from,
   * and revises once only when its verdict is material. A technical
   * failure is FAILED with its reason, never a quiet "looks fine".
   */
  async function critiqueAndRevise(
    actor: ActorContext,
    input: WorkforceDocumentInput,
  ): Promise<WorkforceDocumentResult> {
    const failed = (message: string): WorkforceDocumentResult => ({
      status: "FAILED",
      message,
    });
    if (dependencies.critic === undefined)
      return failed("No reviewer is available to critique this document.");
    const source = input.source;
    if (source === undefined)
      return failed("The document to review was not prepared.");
    const subject: Extract<QSubjectRef, { kind: "COMPANY" }> = {
      kind: "COMPANY",
      companyId: source.companyId,
    };
    const runId = QRunIdSchema.parse(input.qRunId);
    const correlationId = createCorrelationId();
    const decision = await dependencies.firewall.plan({
      actor,
      runId,
      correlationId,
      capability: "ANSWER",
      subjects: [subject],
    });
    if (decision.outcome !== "AUTHORISED")
      return failed("This document can no longer be reviewed as you.");
    const current = await dependencies.preparation.port.currentVersion(
      actor,
      source.artifactId,
    );
    if (current === null)
      return failed("This document can no longer be read as you.");
    if (current.instruction?.startsWith(REVIEWER_REVISION_PREFIX) === true) {
      // A retry after the revision was filed: the review already happened.
      return {
        status: "READY",
        artifactId: source.artifactId,
        companyId: source.companyId,
        review: {
          material: true,
          issues: [],
          revisedToVersion: current.version,
        },
      };
    }
    const grounding = current.content.sections.flatMap((section) => [
      section.body,
      ...section.findings.map((finding) => finding.statement),
    ]);
    const evidence = current.content.sections
      .flatMap((section) =>
        section.findings.map((finding) => `- ${finding.statement}`),
      )
      .join("\n")
      .slice(0, CRITIQUE_EVIDENCE_MAX);
    if (!(await input.canContinue()))
      return failed("Review stopped before it started.");
    const verdict = await dependencies.critic(
      { tenantId: actor.tenantId, userId: actor.userId },
      { jobId: input.jobId, runId: input.runId },
      {
        documentKind: current.content.deck === undefined ? "memo" : "deck",
        principalName: input.principalName ?? "the person",
        companyName: current.title.slice(0, 120),
        purpose: input.goal.slice(0, 600),
        evidence: evidence.length > 0 ? evidence : "(no findings recorded)",
        document: critiqueText(current.content),
      },
    );
    if (verdict === null)
      return failed(
        "The reviewer could not finish its critique; nothing was changed.",
      );
    const issues = verdict.issues.map((issue) => ({
      kind: issue.kind,
      section: issue.section,
      problem: issue.problem,
    }));
    if (!verdict.material || verdict.issues.length === 0) {
      return {
        status: "READY",
        artifactId: source.artifactId,
        companyId: source.companyId,
        review: { material: false, issues, revisedToVersion: null },
      };
    }
    if (!(await input.canContinue()))
      return failed("Review stopped before the revision.");
    const instruction = `${REVIEWER_REVISION_PREFIX} ${verdict.issues
      .map((issue) => `${issue.section}: ${issue.problem} Fix: ${issue.fix}`)
      .join(" ")}`.slice(0, 1_900);
    const revised = await dependencies.preparation.reviser.revise({
      base: {
        title: current.title,
        summary: current.summary,
        content: current.content,
      },
      instruction,
      grounding,
      sensitivity: decision.plan.maxSensitivity,
      attribution: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        qRunId: runId,
        correlationId,
      },
    });
    const filed = await dependencies.preparation.port.revise({
      actorContext: actor,
      permittedContextPlan: decision.plan,
      qRunId: runId,
      artifactId: source.artifactId,
      instruction,
      content: revised,
    });
    return {
      status: "READY",
      artifactId: filed.artifactId,
      companyId: source.companyId,
      review: {
        material: true,
        issues,
        revisedToVersion: filed.currentVersion,
      },
    };
  }

  return async (
    input: WorkforceDocumentInput & { readonly actor: ActorContext },
  ): Promise<WorkforceDocumentResult> => {
    const unavailable = (): WorkforceDocumentResult => ({
      status: "UNAVAILABLE",
      message: "This document cannot be prepared with the current authority.",
    });
    try {
      const request = input.request;
      if (
        input.actor.organisationId !== input.organisationId ||
        !(await input.canContinue())
      )
        return unavailable();
      const actor = await dependencies.freshActor(input.actor);
      if (
        actor === null ||
        actor.userId !== input.actor.userId ||
        actor.tenantId !== input.actor.tenantId ||
        actor.organisationId !== input.organisationId
      )
        return unavailable();
      if (request.operation === "CRITIQUE_AND_REVISE") {
        return await critiqueAndRevise(actor, input);
      }
      if (isWorkforceAnalysisRequest(request)) {
        return await prepareAnalysis(actor, input, request);
      }
      if (dependencies.preparation.pipeline?.mode !== "JOB")
        return unavailable();
      // The company: the person's own, or the one the approved plan bound
      // from what the goal named. Either way the firewall decides below.
      const companyId =
        request.scope === "OWN_COMPANY"
          ? ((await dependencies.ownCompany(actor))?.companyId ?? null)
          : request.companyId;
      if (companyId === null) return unavailable();
      const subject: Extract<QSubjectRef, { kind: "COMPANY" }> = {
        kind: "COMPANY",
        companyId,
      };
      const runId = QRunIdSchema.parse(input.qRunId);
      const correlationId = createCorrelationId();
      const decision = await dependencies.firewall.plan({
        actor,
        runId,
        correlationId,
        capability: "ANSWER",
        subjects: [subject],
      });
      if (decision.outcome !== "AUTHORISED") return unavailable();
      const workforce = {
        jobId: input.jobId,
        stepKey: input.stepKey,
        intentSha256: createHash("sha256")
          .update(
            JSON.stringify({
              request: input.request,
              goal: input.goal,
              qRunId: input.qRunId,
              tenantId: actor.tenantId,
              userId: actor.userId,
              organisationId: actor.organisationId,
              companyId,
              budgetUsd: input.budgetUsd,
            }),
          )
          .digest("hex"),
        execution: { runId: input.runId, budgetUsd: input.budgetUsd },
      };
      const authority = {
        actorContext: actor,
        permittedContextPlan: decision.plan,
        qRunId: runId,
        subject,
        artifactType: request.kind,
        workforce,
      };
      const outcomeOf = (
        artifact: QArtifactSummary,
      ): WorkforceDocumentResult =>
        artifact.status === "READY" && artifact.currentVersion > 0
          ? { status: "READY", artifactId: artifact.artifactId, companyId }
          : artifact.status === "PREPARING"
            ? { status: "PREPARING", artifactId: artifact.artifactId }
            : {
                status: "FAILED",
                message:
                  "The document pipeline could not finish this document.",
              };
      const prior =
        await dependencies.artifacts.findWorkforceDocument(authority);
      if (prior !== null) return outcomeOf(prior);
      if (!(await input.canContinue())) return unavailable();
      const result = await dependencies.investigate(
        {
          company: subject,
          question: input.goal,
          preparationMode: "EVIDENCE_ONLY",
          publicResearch: false,
        },
        {
          actor,
          runId,
          correlationId,
          capability: "ANSWER",
          plan: decision.plan,
        },
      );
      if (
        result.blocked !== null ||
        result.companyId !== companyId ||
        !(await input.canContinue())
      )
        return unavailable();
      // The approved structured request supplies the shape; evidence supplies
      // the content. No model receives authority to choose either scope or writes.
      const prepared = await prepareOrReviseArtifact({
        artifacts: {
          ...dependencies.preparation,
          pipeline: {
            mode: "JOB",
            port: {
              request: async (request) => {
                if (!(await input.canContinue()))
                  throw new Error("Document continuation stopped");
                const refreshed = await dependencies.freshActor(actor);
                if (
                  refreshed === null ||
                  refreshed.tenantId !== actor.tenantId ||
                  refreshed.userId !== actor.userId ||
                  refreshed.organisationId !== actor.organisationId
                )
                  throw new Error("Document authority unavailable");
                const fresh = await dependencies.firewall.plan({
                  actor: refreshed,
                  runId,
                  correlationId,
                  capability: "ANSWER",
                  subjects: [subject],
                });
                if (fresh.outcome !== "AUTHORISED")
                  throw new Error("Document authority unavailable");
                return (
                  await dependencies.artifacts.requestDocument({
                    ...request,
                    job: {
                      ...request.job,
                      grounding: [...request.job.grounding],
                      sectorCodes: [...request.job.sectorCodes],
                    },
                    actorContext: refreshed,
                    permittedContextPlan: fresh.plan,
                    workforce,
                  })
                ).artifact;
              },
              wait: () => Promise.resolve(null),
            },
          },
        },
        request: {
          runId,
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          capability: "ANSWER",
          subjects: [subject],
          actor,
          correlationId,
          retrieval: { kind: "NOT_CONFIGURED" },
          plan: decision.plan,
        },
        company: subject,
        companyName:
          result.companyName ??
          (request.scope === "OWN_COMPANY" ? "Your company" : "The company"),
        saidVerbatim: input.goal,
        result: {
          ...result,
          artifactRequest: {
            kind: "PREPARE",
            artifactType: request.kind,
            instruction: "",
            visualDirection: null,
            quote: input.goal.slice(0, 400),
          },
        },
        history: [],
        logger: dependencies.logger,
      });
      if (prepared.kind !== "PREPARED") {
        dependencies.logger?.warn(
          {
            jobId: input.jobId,
            stepKey: input.stepKey,
            outcome: prepared.kind,
          },
          "workforce document was not prepared",
        );
      }
      return prepared.kind === "PREPARED"
        ? outcomeOf(prepared.summary)
        : {
            status: "FAILED",
            message:
              prepared.kind === "THIN_RECORD"
                ? "There is too little authorized information on record to prepare this document."
                : "The document could not be prepared.",
          };
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, jobId: input.jobId, stepKey: input.stepKey },
        "workforce document preparation threw",
      );
      return unavailable();
    }
  };
}
