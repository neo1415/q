"use client";

import "@/features/q/answer-canvas.css";

import { useEffect } from "react";

import {
  QArtifactIdSchema,
  type QAnswerCardsBlock,
} from "@capital-q/contracts";
import {
  History,
  ICON_SIZE,
  ICON_STROKE,
  PanelRight,
} from "@capital-q/ui/icons";

import { QAperture } from "@/features/q-aperture";
import { AnswerCanvas } from "@/features/q/answer-canvas";
import {
  DEMO_COMPARE,
  DEMO_RESEARCH,
  demoTop,
} from "@/features/q/answer-canvas-fixtures";
import { AnswerChipView } from "@/features/q/answer-chip";
import type { QTurn } from "@/features/q/conversation";
import { useBoardMarks } from "@/features/q/q-board";
import { QBoardTimeline } from "@/features/q/q-board-timeline";

const at = (hours: number, minutes: number, daysAgo = 0) =>
  new Date(Date.UTC(2026, 9, 5 - daysAgo, hours, minutes)).toISOString();

const person = (id: string, text: string): QTurn => ({
  kind: "PERSON",
  id,
  text,
  unconfirmed: false,
});
const answer = (
  id: string,
  when: string,
  text: string,
  blocks: Extract<QTurn, { kind: "Q" }>["blocks"],
  sourceCount = 3,
): QTurn => ({
  kind: "Q",
  id,
  at: when,
  text,
  streaming: false,
  sourceCount,
  publicSources: [],
  findings: [],
  uncertainties: [],
  blocks,
});

const BOARD_TURNS: readonly QTurn[] = [
  person("p0", "Draft an intro to Kestrel Heat"),
  answer(
    "a0",
    at(18, 12, 1),
    "Reviewed and passed. Not sent: it needs your approval.",
    [
      {
        kind: "ARTIFACT_REFERENCE",
        artifactId: QArtifactIdSchema.parse(
          "0f0e0d0c-0b0a-4000-8000-000000000001",
        ),
        type: "Q_REPORT",
        status: "READY",
        title: "Partners’ memo: Norrland Grid",
      },
    ],
    0,
  ),
  person("p1", "Research Y Combinator"),
  answer(
    "a1",
    at(20, 40),
    "Y Combinator invests in very early companies, in several batches a year.",
    [DEMO_RESEARCH],
    9,
  ),
  person("p2", "Top three for my mandate"),
  answer(
    "a2",
    at(21, 4),
    "Three stand out. Norrland Grid fits best.",
    [demoTop(3)],
    4,
  ),
  person("p3", "Compare them side by side"),
  answer(
    "a3",
    at(21, 6),
    "Norrland leads on traction, with documents to back it. Atlas’s revenue is a claim so far.",
    [DEMO_COMPARE],
    5,
  ),
];

const SAID: Readonly<Record<string, readonly string[]>> = {
  top: [
    "Norrland Grid fits best: a seed round in your range, and revenue backed by statements.",
    "Kestrel Heat is close behind: a strong team, and the round has no lead yet.",
    "Atlas Ledger fits the sector, but its revenue is only a claim so far.",
  ],
  compare: [
    "Norrland leads on traction, with documents to back it.",
    "Kestrel has the strongest team of the three.",
    "Atlas fits the sector; the revenue is a claim so far.",
  ],
};

function QFrame({
  boardCount,
  children,
}: {
  readonly boardCount: number;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid min-h-dvh max-w-[1180px] grid-rows-[auto_1fr_auto]">
      <header className="flex items-center justify-between px-4 pt-2.5 pb-1 sm:px-6">
        <h1 className="m-0 text-xl font-medium">Q</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="cq-ac-x"
            aria-label="Past conversations"
          >
            <History
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
          </button>
          <button
            type="button"
            className="cq-ac-btn min-h-11"
            data-q-control="board"
          >
            <PanelRight
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            Board
            <span className="cq-board-count">{boardCount}</span>
          </button>
        </div>
      </header>
      <main className="flex flex-col gap-3.5 overflow-auto px-4 pt-1 pb-3 sm:px-6 sm:pt-2">
        {children}
      </main>
      <div className="mx-3 mb-4 grid grid-cols-[1fr_44px] items-center rounded-[22px] border border-(--cq-border) bg-(--cq-surface-raised) py-1 pr-1 pl-4 sm:mx-6">
        <span className="text-(--cq-text-tertiary)">Ask Q anything</span>
        <span
          className="h-11 w-11 rounded-full bg-(--cq-accent)"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

export function CanvasPreview({
  state,
  n,
  focus,
  theme,
}: {
  readonly state: string;
  readonly n: number;
  readonly focus: number;
  readonly theme: "light" | "dark";
}) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const marks = useBoardMarks("dev-canvas");
  const pin = marks.pin;
  useEffect(() => {
    if (state === "board") pin("a3");
  }, [state, pin]);

  if (state === "board" || state === "board-empty") {
    return (
      <div className="min-h-dvh bg-(--cq-canvas)">
        <QBoardTimeline
          conversationId="dev-canvas"
          turns={state === "board" ? BOARD_TURNS : []}
          onClose={() => undefined}
          onShow={() => undefined}
          onOpenArtifact={() => undefined}
          onAsk={() => undefined}
          suggestions={["Top three for my mandate", "What changed this week?"]}
          now={new Date(Date.UTC(2026, 9, 5, 22, 0))}
        />
      </div>
    );
  }
  if (state === "chip") {
    return (
      <div className="min-h-dvh bg-(--cq-canvas) p-4 sm:p-6">
        <h1 className="m-0 mb-4 text-2xl font-medium">Discover</h1>
        <div className="aspect-[9/13] max-w-[760px] rounded-[18px] bg-(--cq-surface-strong) sm:aspect-[16/10]" />
        <AnswerChipView
          chip={{
            answerId: "a2",
            heading: "Top three ready",
            names: "Norrland, Kestrel, Atlas",
            hues: [1, 2, 3],
          }}
          home="/home"
          onDismiss={() => undefined}
        />
      </div>
    );
  }

  let block: QAnswerCardsBlock = demoTop(n);
  let asked =
    n === 3
      ? "Top three for your mandate"
      : n === 1
        ? "Top pick for your mandate"
        : `Top ${String(n)} for your mandate`;
  let shownFocus = focus;
  let said =
    SAID["top"]?.[focus] ??
    `${block.cards[focus]?.name ?? ""}: ${(block.cards[focus]?.reasons[0] ?? "").toLowerCase()}.`;
  if (state === "overview") {
    shownFocus = -1;
    said = "Want them side by side, or an intro to Norrland?";
  } else if (state === "compare") {
    block = DEMO_COMPARE;
    asked = "Compare them side by side";
    said = SAID["compare"]?.[focus] ?? "";
  } else if (state === "research") {
    block = DEMO_RESEARCH;
    asked = "Research Y Combinator";
    said = DEMO_RESEARCH.cards[focus]?.said ?? "";
  }
  return (
    <div className="min-h-dvh bg-(--cq-canvas) text-(--cq-text-primary)">
      <QFrame boardCount={2}>
        <AnswerCanvas
          block={block}
          asked={asked}
          said={said}
          focus={shownFocus}
          presence={<QAperture state="SPEAKING" size={44} />}
          onFocus={() => undefined}
          onCloseCard={() => undefined}
          onCloseAll={() => undefined}
          onFollowUp={() => undefined}
          onAsk={() => undefined}
          onPin={() => undefined}
          onOpenProfile={() => undefined}
        />
      </QFrame>
    </div>
  );
}
