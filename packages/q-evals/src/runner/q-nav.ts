import {
  decideNavigation,
  listedRecordResolver,
  sameNavigationPlace,
  navigationSiteMap,
  situationHeader,
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
import {
  company,
  Q_NAV_FOUNDER_COMPANY_KEY,
  Q_NAV_RECORDS,
  type QNavRecords,
} from "../datasets/q-nav/world.js";
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
  options: {
    /** Cases decided at once (turns within a case stay in order). */
    readonly concurrency?: number;
  } = {},
): Promise<QNavRun> {
  const byCase: QNavTurnGrade[][] = cases.map(() => []);
  const runCase = async (evalCase: QNavCase, into: QNavTurnGrade[]) => {
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
        // A founder's own company is theirs ("my company", "us").
        records:
          evalCase.side === "FOUNDER"
            ? {
                ...Q_NAV_RECORDS,
                own: {
                  kind: "COMPANY" as const,
                  name: company(Q_NAV_FOUNDER_COMPANY_KEY).name,
                  id: company(Q_NAV_FOUNDER_COMPANY_KEY).id,
                },
              }
            : Q_NAV_RECORDS,
      });
      into.push(gradeQNavTurn(evalCase, index, reply));
    }
  };
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next;
      next += 1;
      const evalCase = cases[i];
      const into = byCase[i];
      if (evalCase !== undefined && into !== undefined)
        await runCase(evalCase, into);
    }
  };
  const workers = Math.max(1, Math.min(options.concurrency ?? 1, cases.length));
  await Promise.all(Array.from({ length: workers }, worker));
  // Graded in the dataset's order, however many ran at once.
  const grades = byCase.flat();
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
  /** The proposer gets the turn and the pipeline's own model input. */
  propose: (
    input: QNavDecisionInput,
    navigation: QNavigationInput,
  ) => Promise<NavigationDecisionResult | null>,
  config: QNavigationPolicyConfig = { movesAllowed: true },
  /** Samples voted per turn (decision 78; production's NAVIGATION_VOTES). */
  votes = 1,
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
        situation: evalSituation(input),
      };
      // The production pipeline itself: decide (voted), resolve, policy.
      const outcome = await decideNavigation(
        {
          decider: { decide: (navigation) => propose(input, navigation) },
          canOpen: (page) => sidesOf(page).includes(input.side),
          config,
          resolver: listedRecordResolver(pipelineInput.records),
          votes,
        },
        pipelineInput,
        {
          tenantId: "00000000-0000-4000-8000-000000000000",
          userId: "00000000-0000-4000-8000-000000000000",
          correlationId: `q-nav:${input.caseId}`,
        },
      );
      return {
        decision: outcome.decision,
        target: outcome.target,
        openPane: outcome.openPane,
        remembered: outcome.remembered,
      };
    },
  };
}

/**
 * The situation production gives the decision (situationHeader, W3's
 * FOCUS), from the turn's own synthetic world: their side, a founder's own
 * company as theirs, and the record on the page pane by name. A fixed
 * date, so a run is reproducible.
 */
function evalSituation(input: QNavDecisionInput): string {
  const at = input.context.at;
  const company = input.records.companies.find((c) => c.id === at.recordId);
  const investor = input.records.investors.find((i) => i.id === at.recordId);
  const own = input.records.own;
  return situationHeader({
    now: new Date("2026-11-06T09:00:00.000Z"),
    asker: {
      displayName: null,
      role: input.side,
      organisation: own?.name ?? null,
      timeZone: null,
      ...(own === undefined
        ? {}
        : {
            own: {
              kind: "COMPANY" as const,
              city: null,
              country: null,
              website: null,
            },
          }),
      ...(company !== undefined
        ? { onScreen: { kind: "COMPANY" as const, name: company.name } }
        : investor !== undefined
          ? {
              onScreen: {
                kind: "INVESTOR_ORGANISATION" as const,
                name: investor.name,
              },
            }
          : {}),
    },
    surface: "DOCK",
    page: null,
  });
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
