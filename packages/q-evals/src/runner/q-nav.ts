import {
  applyNavigationPolicy,
  resolveNavigationPlace,
  sameNavigationPlace,
  navigationSiteMap,
  targetToSitePlace,
  type QNavigationInput,
  type QNavigationPolicyConfig,
} from "@capital-q/model-gateway/q";
import type { NavigationDecisionResult } from "@capital-q/q-core";

import type {
  QNavCase,
  QNavContext,
  QNavReply,
  QNavSide,
  QNavTarget,
} from "../datasets/q-nav/contracts.js";
import { sidesOf } from "../datasets/q-nav/vocabulary.js";
import { Q_NAV_RECORDS, type QNavRecords } from "../datasets/q-nav/world.js";
import {
  gradeQNavTurn,
  summariseQNav,
  type QNavSummary,
  type QNavTurnGrade,
} from "../graders/q-nav.js";

/**
 * What a navigation subject sees on a turn: what Q would know, never the
 * expectation. `history` is the case's earlier turns as said (their words
 * and Q's), for pronouns, ordinals and follow-ups.
 */
export type QNavDecisionInput = {
  readonly caseId: string;
  readonly side: QNavSide;
  readonly history: readonly { readonly user: string; readonly q: string }[];
  readonly user: string;
  readonly modality: "TEXT" | "VOICE";
  readonly language: string;
  readonly context: QNavContext;
  /** What they may resolve by name (W2.3's job), ids and all. */
  readonly records: QNavRecords;
};

export type QNavSubject = {
  readonly name: string;
  readonly decide: (input: QNavDecisionInput) => Promise<QNavReply>;
};

export type QNavRun = {
  readonly subject: string;
  readonly grades: readonly QNavTurnGrade[];
  readonly summary: QNavSummary;
};

export async function runQNav(
  subject: QNavSubject,
  cases: readonly QNavCase[],
): Promise<QNavRun> {
  const grades: QNavTurnGrade[] = [];
  for (const evalCase of cases) {
    for (const [index, turn] of evalCase.turns.entries()) {
      const reply = await subject.decide({
        caseId: evalCase.id,
        side: evalCase.side,
        history: evalCase.turns
          .slice(0, index)
          .map((t) => ({ user: t.user, q: t.q })),
        user: turn.user,
        modality: turn.modality,
        language: turn.language,
        context: turn.context,
        records: Q_NAV_RECORDS,
      });
      grades.push(gradeQNavTurn(evalCase, index, reply));
    }
  }
  return { subject: subject.name, grades, summary: summariseQNav(grades) };
}

/**
 * The scripted reference (CI): answers every turn as expected. It must
 * score 100% and pass both gates; any miss is a dataset or grader defect.
 */
export function referenceQNavSubject(cases: readonly QNavCase[]): QNavSubject {
  const byKey = new Map<string, QNavReply>();
  for (const c of cases) {
    c.turns.forEach((t, i) => {
      byKey.set(`${c.id}#${String(i)}`, {
        decision: t.expect.decision,
        target: t.expect.target,
        openPane: t.expect.openPane,
        remembered: t.expect.remembered,
      });
    });
  }
  return {
    name: "q-nav:reference",
    decide: (input) => {
      const reply = byKey.get(
        `${input.caseId}#${String(input.history.length)}`,
      );
      if (reply === undefined)
        return Promise.reject(new Error(`no reference for ${input.caseId}`));
      return Promise.resolve(reply);
    },
  };
}

// --- W4.1–W4.3: the decision pipeline as a subject -----------------------

/**
 * Q's navigation pipeline as a subject: a proposer (the NAVIGATION_DECISION
 * model live, or a scripted one in CI) whose proposal goes through the
 * real resolution (names to ids, W4.3) and the real policy (the hard
 * constraints, W4.2) of `@capital-q/model-gateway/q`. The model sees W2's
 * full site-map digest for the side (DECISIONS 73); access is the site
 * map's audience, as the vocabulary derives it.
 */
export function navigationPipelineSubject(
  name: string,
  propose: (
    input: QNavDecisionInput,
  ) => Promise<NavigationDecisionResult | null>,
  config: QNavigationPolicyConfig = { movesAllowed: true },
): QNavSubject {
  return {
    name,
    decide: async (input) => {
      const pipelineInput: QNavigationInput = {
        utterance: input.user,
        recentTurns: input.history,
        side: input.side,
        pane: {
          at: input.context.at,
          previous: input.context.previous,
          pane: input.context.pane,
          dirty: input.context.dirty,
          busy: input.context.busy,
        },
        pageText: input.context.pageText,
        records: input.records,
        siteMap: navigationSiteMap(input.side),
      };
      const proposal = await propose(input);
      const resolution =
        proposal === null || proposal.decision === "STAY"
          ? null
          : resolveNavigationPlace(proposal, pipelineInput);
      const outcome = applyNavigationPolicy({
        proposal,
        resolution,
        pane: pipelineInput.pane,
        canOpen: (page) => sidesOf(page).includes(input.side),
        config,
      });
      return {
        decision: outcome.decision,
        target: outcome.target,
        openPane: outcome.openPane,
        remembered: outcome.remembered,
      };
    },
  };
}

/** The place said back by names, as the model would (never an id). */
export function placeByName(
  target: QNavTarget,
  records: QNavRecords,
): NavigationDecisionResult["place"] {
  const site = targetToSitePlace(target);
  if (site === null) return null;
  const company = records.companies.find((c) => c.id === target.recordId);
  const investor = records.investors.find((i) => i.id === target.recordId);
  const thing = records.things.find(
    (t) => t.id === target.recordId || t.id === target.itemId,
  );
  const document = company?.documents.find((d) => d.id === target.documentId);
  return {
    route: site.route,
    record:
      company !== undefined
        ? { kind: "COMPANY", name: company.name }
        : investor !== undefined
          ? { kind: "INVESTOR", name: investor.name }
          : thing !== undefined
            ? { kind: "THING", name: thing.title }
            : null,
    tab: site.tab,
    document: document?.title ?? null,
    slide: site.slide,
    sectionId: site.sectionId,
    position: site.position,
  };
}

/**
 * A scripted proposer for CI that knows where each turn is about and
 * ignores every hard constraint: it moves away from unsaved work and a
 * busy pane, behind a collapsed pane, to the page already open and to a
 * deleted record. Only the code's resolution and policy can turn that
 * into the expected outcome; any miss is a defect there.
 */
export function naiveReferenceProposer(
  cases: readonly QNavCase[],
): (input: QNavDecisionInput) => Promise<NavigationDecisionResult | null> {
  const byId = new Map(cases.map((c) => [c.id, c]));
  return (input) => {
    const evalCase = byId.get(input.caseId);
    const turn = evalCase?.turns[input.history.length];
    if (evalCase === undefined || turn === undefined)
      return Promise.resolve(null);
    const expect = turn.expect;
    const move = (
      place: NavigationDecisionResult["place"],
      back = false,
    ): NavigationDecisionResult => ({
      decision: "MOVE",
      place,
      back,
      askedForPage: expect.openPane || input.context.pane === "OPEN",
      reason: "scripted",
    });
    const where = expect.target ?? expect.remembered;
    if (where !== null) {
      const previous = input.context.previous;
      const back = previous !== null && sameNavigationPlace(previous, where);
      return Promise.resolve(
        back ? move(null, true) : move(placeByName(where, input.records)),
      );
    }
    if (evalCase.category === "ALREADY_THERE")
      return Promise.resolve(
        move(placeByName(input.context.at, input.records)),
      );
    if (evalCase.category === "DELETED_RECORD") {
      const [gone] = input.records.deleted;
      return Promise.resolve(
        gone === undefined
          ? null
          : move({
              route: "/company/[companyId]",
              record: { kind: "COMPANY", name: gone.name },
              tab: null,
              document: null,
              slide: null,
              sectionId: null,
              position: null,
            }),
      );
    }
    if (evalCase.category === "GO_BACK")
      return Promise.resolve(move(null, true));
    return Promise.resolve({
      decision: "STAY",
      place: null,
      back: false,
      askedForPage: false,
      reason: "scripted",
    });
  };
}
