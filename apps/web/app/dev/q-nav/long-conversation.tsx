"use client";

import type { ReactNode } from "react";

import { demoTop } from "@/features/q/answer-canvas-fixtures";
import type { QTurn } from "@/features/q/conversation";
import { QSessionTurnsOverride } from "@/features/q/q-session";

type Block = Extract<QTurn, { kind: "Q" }>["blocks"][number];

function answer(
  id: string,
  text: string,
  blocks: readonly Block[] = [],
): QTurn {
  return {
    kind: "Q",
    id,
    text,
    streaming: false,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks,
  };
}

function person(id: string, text: string): QTurn {
  return { kind: "PERSON", id, text, unconfirmed: false };
}

/**
 * A live-shaped conversation for screenshots (owner 2026-11-06): twelve
 * turns ending in discovery cards, fictional throughout.
 */
const TURNS: readonly QTurn[] = [
  person("p1", "What changed on my pipeline this week?"),
  answer(
    "q1",
    "Two replies came in: Ledgerfold accepted a call, and Spheros sent their deck.",
  ),
  person("p2", "Summarise the Spheros deck for me."),
  answer(
    "q2",
    "Spheros sells compliance software to mid-size lenders. Revenue is growing, but the deck gives no churn figure, so retention is unknown.",
  ),
  person("p3", "What would you ask them first?"),
  answer(
    "q3",
    "I'd ask for monthly churn by cohort, the sales cycle length, and who signs the contract on the lender's side.",
  ),
  person("p4", "Draft that as a short note."),
  answer(
    "q4",
    "Here's a draft for your approval. Nothing is sent until you approve it.",
  ),
  person("p5", "Who else should I look at in lending infrastructure?"),
  answer(
    "q5",
    "I'd widen it to payments and treasury tooling as well; your mandate allows both.",
  ),
  person("p6", "Find me founders raising in fintech right now."),
  answer(
    "q6",
    "I found five founders raising now that fit your mandate. Brightwell fits best on stage and region.",
    [{ ...demoTop(5), kind: "ANSWER_CARDS" }],
  ),
];

export function LongConversation({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <QSessionTurnsOverride turns={TURNS}>{children}</QSessionTurnsOverride>
  );
}
