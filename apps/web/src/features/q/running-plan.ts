"use client";

import { useEffect, useMemo, useState } from "react";

import type { QPlanView } from "@capital-q/contracts";

import { startPacedPoll } from "@/features/polling/paced-poll";

import { Q_APPROVAL_DECIDED_EVENT } from "./approval-decided";
import type { QTurn } from "./conversation";
import { readPlanAction } from "./plan-actions";

/** The newest plan this conversation shows: its id and version. */
export function latestPlanOf(
  turns: readonly QTurn[] | undefined,
): { readonly planId: string; readonly version: number } | null {
  for (const turn of [...(turns ?? [])].reverse()) {
    if (turn.kind !== "Q") continue;
    const plan = turn.blocks.findLast((block) => block.kind === "PLAN");
    if (plan !== undefined && plan.kind === "PLAN") {
      return { planId: plan.planId, version: plan.version };
    }
  }
  return null;
}

/** Paced as the plan card's own follow; bounded, quiet while hidden. */
const PACE = { firstMs: 2_000, maxMs: 15_000 } as const;
const FOLLOW_MAX_MS = 15 * 60_000;

/**
 * Nothing more to follow. An accepted plan is about to run, so it is
 * followed on; one only offered (or on the board) waits for the person,
 * and is read again when the conversation moves (below).
 */
function settled(view: QPlanView): boolean {
  if (view.status === "ACCEPTED") return false;
  return (
    view.status !== "EXECUTING" ||
    view.plan.steps.every(
      (step) => step.status === "DONE" || step.status === "SKIPPED",
    )
  );
}

/**
 * Live 2026-11-04 (N2): the conversation's newest plan, read as its owner
 * (the same server action the plan card reads), followed while it runs and
 * read again when an approval is decided here (the plan's start). Null
 * when there is no plan or it cannot be read.
 */
export function useRunningPlan(
  turns: readonly QTurn[] | undefined,
): QPlanView | null {
  const latest = latestPlanOf(turns);
  const planId = latest?.planId ?? null;
  const version = latest?.version ?? null;
  // Acceptance 2026-11-04 J4: a typed "okay" approves the plan through
  // the server, so no approval-decided event fires in this tab; the plan
  // was read once (OFFERED), never again, and its steps never showed.
  // Q's next turn ("Running it now") is the cue to read it again.
  const turnCount = turns?.length ?? 0;
  const [view, setView] = useState<QPlanView | null>(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    const again = () => setReads((count) => count + 1);
    window.addEventListener(Q_APPROVAL_DECIDED_EVENT, again);
    return () => window.removeEventListener(Q_APPROVAL_DECIDED_EVENT, again);
  }, []);

  useEffect(() => {
    // No plan: nothing read (the memo below shows none for another id).
    if (planId === null || version === null) return;
    const started = Date.now();
    let shown = "";
    const poll = startPacedPoll(
      async () => {
        const read = await readPlanAction(planId, version);
        if (!read.ok) return "done";
        setView(read.view);
        if (settled(read.view) || Date.now() - started > FOLLOW_MAX_MS) {
          return "done";
        }
        const key = read.view.plan.steps
          .map((step) => `${step.key}:${step.status}`)
          .join(",");
        const outcome = key === shown ? "same" : "changed";
        shown = key;
        return outcome;
      },
      PACE,
      { immediate: true },
    );
    return () => poll.stop();
  }, [planId, version, reads, turnCount]);

  return useMemo(
    () => (view !== null && view.plan.planId === planId ? view : null),
    [view, planId],
  );
}
