"use client";

import "@/features/q/answer-canvas.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createQStreamState } from "@capital-q/api-client";
import {
  QConversationDetailSchema,
  type QConversationDetail,
  type QMessage,
} from "@capital-q/contracts";
import { ICON_SIZE, ICON_STROKE, PanelRight } from "@capital-q/ui/icons";

import { QAperture } from "@/features/q-aperture";
import { AnswerChipFor } from "@/features/q/answer-chip";
import { turnsFrom } from "@/features/q/conversation";
import { useBoardMarks } from "@/features/q/q-board";
import { QBoardTimeline } from "@/features/q/q-board-timeline";
import { QPresenceStage, showOnStage } from "@/features/q/q-presence-stage";
import { recordSettled } from "@/features/q/use-q-conversation";
import { rereadUntilSettled } from "@/features/q/voice-reread";

const RECORD = "/dev/q-cards/record";
const CONVERSATION = "dev-q-cards";

/** The recorded conversation, validated; null for anything else. */
async function fetchRecord(): Promise<QConversationDetail | null> {
  try {
    const response = await fetch(RECORD, { cache: "no-store" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const detail = QConversationDetailSchema.safeParse(body);
    return detail.success ? detail.data : null;
  } catch {
    return null;
  }
}

/**
 * The Q page's stage, Board and answer chip over a recorded conversation
 * the test serves (see page.tsx). "Typed" reads the record once, as a
 * typed run's stream end does; "Voice" reads it until its newest run is
 * stored, as `q-session` does after a voice turn.
 */
export function QCardsHarness({ page }: { readonly page: "q" | "other" }) {
  const [messages, setMessages] = useState<readonly QMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [boardOpen, setBoardOpen] = useState(false);
  const [landed, setLanded] = useState(0);
  const marks = useBoardMarks(CONVERSATION);

  const apply = useCallback((detail: QConversationDetail | null): boolean => {
    if (detail === null) return false;
    setMessages(detail.messages);
    setConversationId(detail.conversation.conversationId);
    return recordSettled(detail.latestRun);
  }, []);
  const read = useCallback(
    async (): Promise<boolean> => apply(await fetchRecord()),
    [apply],
  );

  // The conversation is read once as the page opens.
  useEffect(() => {
    let live = true;
    void fetchRecord().then((detail) => {
      if (!live) return;
      apply(detail);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [apply]);

  const stopVoice = useRef<(() => void) | null>(null);
  useEffect(() => () => stopVoice.current?.(), []);
  const voiceTurn = () => {
    stopVoice.current?.();
    stopVoice.current = rereadUntilSettled({ read, intervalMs: 300 });
  };

  const turns = useMemo(
    () => turnsFrom({ ...createQStreamState(), messages: [...messages] }, []),
    [messages],
  );
  const onBoardLanded = useCallback(() => setLanded((n) => n + 1), []);

  const controls = (
    <div className="flex flex-wrap gap-2" data-harness-controls>
      <button type="button" className="cq-ac-btn" onClick={() => void read()}>
        Typed answer
      </button>
      <button type="button" className="cq-ac-btn" onClick={voiceTurn}>
        Voice turn
      </button>
    </div>
  );

  if (page === "other") {
    return (
      <div className="min-h-dvh bg-(--cq-canvas) p-4 text-(--cq-text-primary) sm:p-6">
        <h1 className="m-0 mb-4 text-2xl font-medium">Discover</h1>
        {controls}
        <div className="mt-4 aspect-[9/13] max-w-[760px] rounded-[18px] bg-(--cq-surface-strong) sm:aspect-[16/10]" />
        <AnswerChipFor
          pathname="/discover"
          turns={turns}
          loading={loading}
          conversationId={conversationId}
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-(--cq-canvas) text-(--cq-text-primary)">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        {controls}
        <button
          type="button"
          className="cq-ac-btn"
          aria-label="Board"
          aria-expanded={boardOpen}
          data-q-control="board"
          data-landed={String(landed)}
          onClick={() => setBoardOpen((open) => !open)}
        >
          <PanelRight
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
          Board
        </button>
      </header>
      <main className="mx-auto flex w-full max-w-[1180px] flex-col px-4 py-4">
        <QPresenceStage
          turns={turns}
          captions={false}
          caption={null}
          onBoardLanded={onBoardLanded}
          onPin={marks.pin}
          presence={(compact, mini) => (
            <QAperture
              state="IDLE"
              size={mini === true ? 44 : compact ? 64 : 200}
              stage
              showing={compact}
            />
          )}
        />
      </main>
      {boardOpen ? (
        <aside aria-label="Board panel" className="px-4 pb-6">
          <QBoardTimeline
            conversationId={CONVERSATION}
            turns={turns}
            onClose={() => setBoardOpen(false)}
            onShow={(answerId) => {
              setBoardOpen(false);
              showOnStage(answerId);
            }}
            onOpenArtifact={() => undefined}
          />
        </aside>
      ) : null}
    </div>
  );
}
