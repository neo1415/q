import {
  Annotation,
  END,
  START,
  StateGraph,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";

import type {
  Candidate,
  DelegationRef,
  OutreachGrant,
  QWorkPorts,
  ShortlistPick,
} from "./types.js";

/**
 * The investor's outreach, first part (ADR 0029):
 *
 *   source → shortlist → open lanes (express interest, one batched notice)
 *
 * Sourcing reads only the investor's own Discover feed and what they may
 * already see of each company; the shortlist is the one model call, and a
 * pick counts only with a reason that quotes the material (checked here,
 * in code, so Q never picks on something it made up). Each founder then
 * gets a lane thread of their own.
 */

export type OutreachState = {
  ref: DelegationRef;
  grant: OutreachGrant;
  candidates: readonly Candidate[];
  picks: readonly ShortlistPick[];
  /** The shortlist call could not be made; nothing was invented instead. */
  failed: boolean;
  lanes: readonly string[];
};

const replace = <T>(initial: () => T) =>
  Annotation<T>({ reducer: (_left, right) => right, default: initial });

export const OutreachAnnotation = Annotation.Root({
  ref: Annotation<DelegationRef>,
  grant: Annotation<OutreachGrant>,
  candidates: replace<readonly Candidate[]>(() => []),
  picks: replace<readonly ShortlistPick[]>(() => []),
  failed: replace<boolean>(() => false),
  lanes: replace<readonly string[]>(() => []),
});

/** Candidates read per outreach: bounded cost, bounded context. */
export const MAX_CANDIDATES = 15;

const normalise = (text: string) =>
  text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A pick stands only on reasons whose quote is really in the candidate's
 * material, for a company that was really a candidate, at most the
 * approved number. Not a word list over a person's words: a substring
 * check of model output against the source it claims to quote.
 */
export function groundedPicks(
  picks: readonly ShortlistPick[],
  candidates: readonly Candidate[],
  max: number,
): ShortlistPick[] {
  const byId = new Map(candidates.map((c) => [c.companyId, c]));
  const kept: ShortlistPick[] = [];
  for (const pick of picks) {
    const candidate = byId.get(pick.companyId);
    if (candidate === undefined) continue;
    if (kept.some((existing) => existing.companyId === pick.companyId)) {
      continue;
    }
    const material = normalise(candidate.material);
    const reasons = pick.reasons.filter(
      (reason) =>
        reason.quote.trim().length >= 8 &&
        material.includes(normalise(reason.quote)),
    );
    if (reasons.length === 0) continue;
    kept.push({ companyId: pick.companyId, name: candidate.name, reasons });
    if (kept.length >= max) break;
  }
  return kept;
}

export function buildOutreachGraph(
  ports: QWorkPorts,
  saver: BaseCheckpointSaver,
) {
  type Update = Partial<OutreachState>;

  const source = async (state: OutreachState): Promise<Update> => {
    const candidates = (await ports.source(state.ref)).slice(0, MAX_CANDIDATES);
    await ports.step(
      state.ref,
      null,
      "sourced",
      candidates.length === 0
        ? "Q looked through your feed and found no companies to consider."
        : `Q read ${String(candidates.length)} companies from your feed: profiles, pitch transcripts and decks you can see.`,
    );
    await ports.summarise(
      state.ref,
      `Reading ${String(candidates.length)} companies from your feed.`,
    );
    return { candidates };
  };

  const shortlist = async (state: OutreachState): Promise<Update> => {
    if (state.candidates.length === 0) return { picks: [] };
    const raw = await ports.shortlist(state.ref, state.grant, state.candidates);
    if (raw === null) return { failed: true, picks: [] };
    return {
      picks: groundedPicks(raw, state.candidates, state.grant.maxCompanies),
    };
  };

  const open = async (state: OutreachState): Promise<Update> => {
    if (state.failed) {
      await ports.notify(state.ref, {
        key: "shortlist-failed",
        title: "Q couldn't finish choosing companies",
        body: "Nothing was sent. Ask Q to try again.",
        link: `/work/${state.ref.delegationId}`,
        priority: "NEEDS_YOU",
      });
      await ports.finishDelegation(
        state.ref,
        "FAILED",
        "Q couldn't finish choosing companies; nothing was sent.",
      );
      return {};
    }
    if (state.picks.length === 0) {
      await ports.notify(state.ref, {
        key: "no-fits",
        title: "Q found no companies in your feed that fit yet",
        body: "Q will not contact anyone. Your feed refreshes as companies join.",
        link: "/discover",
        priority: "UPDATE",
      });
      await ports.finishDelegation(
        state.ref,
        "DONE",
        "No companies in your feed fit yet.",
      );
      return {};
    }
    const lanes: string[] = [];
    const interested: string[] = [];
    const skipped: string[] = [];
    for (const pick of state.picks) {
      const expressed = await ports.expressInterest(state.ref, pick.companyId);
      const laneId = await ports.openLane(state.ref, {
        companyId: pick.companyId,
        relationshipId:
          expressed.outcome === "OK" ? expressed.relationshipId : null,
        counterpartName: pick.name,
        stage: expressed.outcome === "OK" ? "WAITING_ACCEPTANCE" : "FAILED",
        reasons: pick.reasons,
      });
      if (expressed.outcome === "OK") {
        lanes.push(laneId);
        interested.push(pick.name);
        await ports.step(
          state.ref,
          laneId,
          `interest:${pick.companyId}`,
          `Q expressed your interest in ${pick.name}: ${pick.reasons[0]?.reason ?? ""}`.slice(
            0,
            500,
          ),
        );
      } else {
        skipped.push(pick.name);
        await ports.updateLane(laneId, {
          lastStep: "Interest could not be expressed here.",
        });
      }
    }
    const fewer =
      state.picks.length < state.grant.maxCompanies
        ? ` Only ${String(state.picks.length)} fit closely enough.`
        : "";
    await ports.notify(state.ref, {
      key: "interest-batch",
      title:
        interested.length === 0
          ? "Q couldn't express interest in the companies it picked"
          : `Q expressed interest in ${interested.join(", ")}`.slice(0, 200),
      body:
        interested.length === 0
          ? null
          : `Waiting for them to accept.${fewer}${skipped.length > 0 ? ` Skipped: ${skipped.join(", ")}.` : ""}`,
      link: `/work/${state.ref.delegationId}`,
      priority: "UPDATE",
    });
    if (lanes.length === 0) {
      await ports.finishDelegation(
        state.ref,
        "DONE",
        "Interest could not be expressed in the companies Q picked.",
      );
    } else {
      await ports.summarise(
        state.ref,
        `Waiting for ${String(lanes.length)} ${lanes.length === 1 ? "company" : "companies"} to accept.`,
      );
    }
    return { lanes };
  };

  return new StateGraph(OutreachAnnotation)
    .addNode("source_step", source)
    .addNode("shortlist_step", shortlist)
    .addNode("open_step", open)
    .addEdge(START, "source_step")
    .addEdge("source_step", "shortlist_step")
    .addEdge("shortlist_step", "open_step")
    .addEdge("open_step", END)
    .compile({ checkpointer: saver });
}
